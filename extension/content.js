(function () {
  let activeInput = null;
  let fillButton = null;
  let dropdownMenu = null;

  // Key icon SVG for the floating button
  const KEY_SVG = `
    <svg viewBox="0 0 24 24">
      <path d="M12.63 2a10 10 0 0 0-7.9 16.14l-3.44 3.44a1 1 0 0 0 1.42 1.42l3.44-3.44A10 10 0 1 0 12.63 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm4.59-11.59a1.5 1.5 0 1 0-2.12-2.12 1.5 1.5 0 0 0 2.12 2.12z"/>
    </svg>
  `;

  // Listen for focus events on inputs
  document.addEventListener('focusin', (e) => {
    const target = e.target;
    if (isFillableInput(target)) {
      activeInput = target;
      showFillButton(target);
    }
  });

  // Remove elements when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (fillButton && !fillButton.contains(e.target) && e.target !== activeInput) {
      removeFillButton();
    }
    if (dropdownMenu && !dropdownMenu.contains(e.target) && !fillButton.contains(e.target)) {
      removeDropdown();
    }
  });

  // Handle window resizing or scrolling
  window.addEventListener('resize', repositionUI);
  document.addEventListener('scroll', repositionUI, true);

  function isFillableInput(el) {
    if (!el) return false;
    const tagName = el.tagName.toLowerCase();
    
    // Check if it is a standard text-like input
    if (tagName === 'textarea') return true;
    if (tagName === 'input') {
      const type = el.type.toLowerCase();
      const fillableTypes = ['text', 'email', 'tel', 'number', 'url', 'search'];
      return fillableTypes.includes(type) && !el.readOnly && !el.disabled;
    }
    
    // Check for custom ARIA textboxes (like Google Forms paragraph fields)
    if (el.getAttribute('role') === 'textbox') {
      return !el.ariaReadOnly && el.getAttribute('contenteditable') === 'true';
    }
    
    return false;
  }

  function showFillButton(input) {
    removeFillButton();
    
    fillButton = document.createElement('button');
    fillButton.className = 'fv-fill-btn';
    fillButton.innerHTML = KEY_SVG;
    fillButton.title = 'Fill with FormVault';
    
    // Position absolute relative to body
    document.body.appendChild(fillButton);
    positionElement(fillButton, input);

    fillButton.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleDropdown();
    });
  }

  function removeFillButton() {
    if (fillButton) {
      fillButton.remove();
      fillButton = null;
    }
  }

  function positionElement(element, target) {
    const rect = target.getBoundingClientRect();
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;

    // Position button inside the input field on the right
    const btnSize = 24;
    const rightOffset = 8;
    const topOffset = (rect.height - btnSize) / 2;

    element.style.left = `${rect.right - btnSize - rightOffset + scrollLeft}px`;
    element.style.top = `${rect.top + topOffset + scrollTop}px`;
  }

  function repositionUI() {
    if (activeInput && fillButton) {
      positionElement(fillButton, activeInput);
    }
    if (activeInput && dropdownMenu) {
      positionDropdown(dropdownMenu, activeInput);
    }
  }

  function toggleDropdown() {
    if (dropdownMenu) {
      removeDropdown();
      return;
    }

    dropdownMenu = document.createElement('div');
    dropdownMenu.className = 'fv-dropdown';
    
    const header = document.createElement('div');
    header.className = 'fv-dropdown-header';
    header.textContent = 'FormVault Profiles';
    dropdownMenu.appendChild(header);

    const listContainer = document.createElement('div');
    listContainer.className = 'fv-dropdown-list';
    dropdownMenu.appendChild(listContainer);

    document.body.appendChild(dropdownMenu);
    positionDropdown(dropdownMenu, activeInput);

    // Fetch profiles from background cache
    chrome.runtime.sendMessage({ action: 'getProfiles' }, (response) => {
      if (response && response.success && response.profiles.length > 0) {
        chrome.storage.local.get(['userEmail'], (storageRes) => {
          const currentUserEmail = (storageRes.userEmail || '').toLowerCase();
          
          response.profiles.forEach((profile) => {
            const item = document.createElement('div');
            item.className = 'fv-dropdown-item';
            
            const isShared = profile.userId && currentUserEmail && profile.sharedWith && profile.sharedWith.includes(currentUserEmail);
            const tagClass = isShared ? 'fv-tag-shared' : 'fv-tag-owner';
            const tagText = isShared ? 'Shared' : 'Owner';

            item.innerHTML = `
              <span class="fv-profile-name">${escapeHtml(profile.name)}</span>
              <span class="fv-profile-tag ${tagClass}">${tagText}</span>
            `;

            item.addEventListener('click', (e) => {
              e.stopPropagation();
              autofillForm(profile);
              removeDropdown();
              removeFillButton();
            });

            listContainer.appendChild(item);
          });
        });
      } else {
        const errorMsg = document.createElement('div');
        errorMsg.className = 'fv-empty-msg';
        
        if (response && response.error === 'EXPIRED') {
          errorMsg.innerHTML = 'Session expired.<br>Click extension icon to log in again.';
        } else if (response && response.error === 'NO_TOKEN') {
          errorMsg.innerHTML = 'Not logged in.<br>Open FormVault popup to sign in.';
        } else {
          errorMsg.innerHTML = 'No profiles synced.<br>Add some on the web dashboard!';
        }
        listContainer.appendChild(errorMsg);
      }
    });
  }

  function positionDropdown(dropdown, target) {
    const rect = target.getBoundingClientRect();
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;

    // Position below the input aligned to the right edge
    dropdown.style.left = `${rect.right - 200 + scrollLeft}px`;
    dropdown.style.top = `${rect.bottom + 4 + scrollTop}px`;
  }

  function removeDropdown() {
    if (dropdownMenu) {
      dropdownMenu.remove();
      dropdownMenu = null;
    }
  }

  // --- Autofill Heuristic Logic ---

  function autofillForm(profile) {
    // 1. Find all input/textarea elements on the page (or within current form)
    let container = null;
    if (activeInput) {
      container = activeInput.closest('form');
      // If no form wrapper (common in Google Forms or SPA frameworks), scan the parent element up a few steps
      if (!container) {
        container = activeInput.closest('[role="list"]') || activeInput.closest('.freebirdFormviewerViewFormContent');
      }
    }
    // Fall back to document if no active input or parent container was found
    if (!container) {
      container = document;
    }

    const inputs = container.querySelectorAll('input, textarea, [role="textbox"]');
    
    // 2. Loop through all found inputs and attempt to match them with profile fields
    inputs.forEach((input) => {
      if (!isFillableInput(input)) return;

      const label = getFieldLabel(input);
      if (!label) return;

      const matchedField = findMatchingField(label, profile.fields);
      if (matchedField) {
        fillFieldValue(input, matchedField.value);
      }
    });
  }

  // Extract human-readable label or question text for an input
  function getFieldLabel(input) {
    // A. Direct aria-label (Very common in Google Forms)
    const ariaLabel = input.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    // B. Check aria-labelledby association
    const ariaLabelledby = input.getAttribute('aria-labelledby');
    if (ariaLabelledby) {
      const ids = ariaLabelledby.split(' ');
      let combinedText = '';
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) combinedText += ' ' + el.textContent;
      });
      combinedText = combinedText.trim();
      if (combinedText) return combinedText;
    }

    // C. Native label elements associated via 'for'
    if (input.id) {
      const labelEl = document.querySelector(`label[for="${input.id}"]`);
      if (labelEl) return labelEl.textContent.trim();
    }

    // D. Check parent label wrappers
    const parentLabel = input.closest('label');
    if (parentLabel) return parentLabel.textContent.trim();

    // E. Fallback to placeholder or name
    if (input.placeholder) return input.placeholder.trim();
    if (input.name) return input.name.trim();

    // F. DOM Traversal (Specifically looking for Google Forms question titles)
    // In Google Forms, the question container holds both the title div and input wrapper
    let parent = input.parentElement;
    for (let i = 0; i < 4 && parent; i++) {
      // Find role="heading", or Google Forms header classes
      const headerEl = parent.querySelector('[role="heading"], .M7eMe');
      if (headerEl && headerEl.textContent) {
        return headerEl.textContent.trim();
      }
      parent = parent.parentElement;
    }

    return '';
  }

  // Normalize string for fuzzy matching (lowercase, strip non-alphanumeric)
  function normalizeStr(str) {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Fuzzy match function linking input label to profile field keys
  function findMatchingField(label, fields) {
    if (!fields || fields.length === 0) return null;

    const normLabel = normalizeStr(label);

    // Stage 1: Exact normalized match
    let match = fields.find(f => normalizeStr(f.label) === normLabel);
    if (match) return match;

    // Stage 2: Fuzzy keyword substring matching
    // e.g. input label "what is your college roll number" matches profile key "roll number" or "college"
    // We prioritize longer keys to avoid false matches (e.g. "first name" matches over "name")
    const sortedFields = [...fields].sort((a, b) => b.label.length - a.label.length);

    for (const field of sortedFields) {
      const normFieldLabel = normalizeStr(field.label);
      
      // Don't match super short words like 'id' or 'no' fuzzily to prevent wrong fills
      if (normFieldLabel.length < 3) continue;

      if (normLabel.includes(normFieldLabel) || normFieldLabel.includes(normLabel)) {
        return field;
      }
    }

    // Stage 3: Direct standard mapping heuristics (fallback helper)
    const mappings = {
      'email': ['email', 'mail', 'e-mail', 'email address'],
      'name': ['name', 'full name', 'first name', 'last name', 'fname', 'lname', 'fullname'],
      'phone': ['phone', 'mobile', 'telephone', 'contact', 'tel', 'number', 'whatsapp'],
      'address': ['address', 'residence', 'street', 'city', 'state', 'country', 'zip', 'pincode'],
      'college': ['college', 'university', 'school', 'institute', 'roll number', 'roll no', 'registration no', 'enrollment']
    };

    for (const [key, aliases] of Object.entries(mappings)) {
      // If the input label relates to one of our category keys
      const matchesCategory = aliases.some(alias => normLabel.includes(alias));
      if (matchesCategory) {
        // Find if we have a field in the profile that matches this category key
        const categoryField = fields.find(f => normalizeStr(f.label).includes(key) || key.includes(normalizeStr(f.label)));
        if (categoryField) return categoryField;
      }
    }

    return null;
  }

  // Fill field value safely, handling framework models and focus states
  function fillFieldValue(input, value) {
    input.focus();

    if (input.tagName.toLowerCase() === 'input' || input.tagName.toLowerCase() === 'textarea') {
      input.value = value;
    } else if (input.getAttribute('contenteditable') === 'true') {
      // Contenteditable divs (often used in web editors or custom textboxes)
      input.innerText = value;
    }

    // Dispatch events so React/Angular/Vue binding libraries sync input models
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Blur to simulate user leaving the input, executing validations
    input.blur();
  }

  // Listen for messages from popup script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'autofill') {
      try {
        autofillForm(message.profile);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }
    return true;
  });

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
  }
})();
