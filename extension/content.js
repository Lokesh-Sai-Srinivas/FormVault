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
      const fillableTypes = ['text', 'email', 'tel', 'number', 'url', 'search', 'date'];
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
    console.log("🚀 [FormVault Debug] Starting Autofill...");
    console.log("Selected Profile:", profile);

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

    console.log("Form Container:", container);

    // A. Fill standard text inputs, textareas, contenteditables, and date fields
    const inputs = container.querySelectorAll('input, textarea, [role="textbox"]');
    console.log(`Found ${inputs.length} text/date inputs.`);
    
    inputs.forEach((input) => {
      if (!isFillableInput(input)) return;

      const label = getFieldLabel(input);
      if (!label) {
        console.warn("Could not extract label for input:", input);
        return;
      }

      const matchedField = findMatchingField(label, profile.fields);
      console.log(`Input: "${label}" | Matched Profile Field:`, matchedField ? matchedField.label : "None");
      
      if (matchedField) {
        fillFieldValue(input, matchedField.value);
        console.log(`Filled "${label}" with value "${matchedField.value}"`);
      }
    });

    // B. Fill Radio buttons and Checkboxes
    // Strategy 1: Google Forms question-card approach (most reliable)
    fillGoogleFormsChoices(container, profile.fields);

    // Strategy 2: Standard HTML radio/checkbox fallback
    const radioAndCheckboxes = container.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    console.log(`Found ${radioAndCheckboxes.length} standard radio/checkbox inputs.`);
    radioAndCheckboxes.forEach((element) => {
      const questionLabel = getQuestionLabelForChoice(element);
      const optionLabel = getOptionLabel(element);
      if (!questionLabel) return;
      const matchedField = findMatchingField(questionLabel, profile.fields);
      console.log(`Standard radio: Q="${questionLabel}", Opt="${optionLabel}" | Match:`, matchedField ? matchedField.label : 'None');
      if (matchedField && optionLabel && isValueMatch(matchedField.value, optionLabel)) {
        if (!element.checked) {
          element.click();
          element.dispatchEvent(new Event('change', { bubbles: true }));
          console.log(`-> Checked standard radio: "${optionLabel}"`);
        }
      }
    });

    // C. Fill Dropdown Menus (standard select and custom ARIA elements)
    const dropdowns = container.querySelectorAll('select, [role="listbox"], [role="combobox"]');
    console.log(`Found ${dropdowns.length} dropdown elements.`);

    dropdowns.forEach((dropdown) => {
      // Standard HTML select element
      if (dropdown.tagName.toLowerCase() === 'select') {
        const label = getFieldLabel(dropdown);
        const matchedField = findMatchingField(label, profile.fields);
        console.log(`Standard Select: "${label}" | Match found:`, matchedField ? matchedField.label : "None");
        
        if (matchedField) {
          const options = dropdown.options;
          for (let i = 0; i < options.length; i++) {
            if (isValueMatch(matchedField.value, options[i].text) || isValueMatch(matchedField.value, options[i].value)) {
              dropdown.selectedIndex = i;
              dropdown.dispatchEvent(new Event('change', { bubbles: true }));
              console.log(`-> Selected dropdown option: "${options[i].text}"`);
              break;
            }
          }
        }
        return;
      }

      // Custom Google Forms / ARIA dropdown
      let label = '';
      const ariaLby = getQuestionAndOptionFromAriaLabelledby(dropdown);
      if (ariaLby) {
        label = ariaLby.question;
      } else {
        label = getQuestionLabelForChoice(dropdown);
      }
      
      const matchedField = findMatchingField(label, profile.fields);
      console.log(`Custom Dropdown: "${label}" | Match found:`, matchedField ? matchedField.label : "None");
      
      if (matchedField) {
        console.log(`-> Attempting to click dropdown: "${label}" to select "${matchedField.value}"`);
        // Open the dropdown menu to expose options
        dropdown.click();
        dropdown.dispatchEvent(new Event('click', { bubbles: true }));

        // Wait for options to render, click match, then close if not found
        setTimeout(() => {
          const options = document.querySelectorAll('[role="option"], .quantumWizMenuPaperselectOption, .appsMaterialWizMenuPaperselectOption');
          console.log(`-> Found ${options.length} options in open dropdown menu.`);
          let foundOption = null;
          for (const option of options) {
            const optionText = option.textContent || option.getAttribute('data-value') || '';
            console.log(`  Dropdown option text: "${optionText.trim()}"`);
            if (isValueMatch(matchedField.value, optionText)) {
              foundOption = option;
              break;
            }
          }

          if (foundOption) {
            foundOption.click();
            foundOption.dispatchEvent(new Event('click', { bubbles: true }));
            console.log(`-> Successfully clicked dropdown option for value "${matchedField.value}"`);
          } else {
            // Close the dropdown if no match was found
            dropdown.click();
            dropdown.dispatchEvent(new Event('click', { bubbles: true }));
            console.warn(`-> No matching option found in dropdown for value "${matchedField.value}". Closed dropdown.`);
          }
        }, 150);
      }
    });
  }

  // -----------------------------------------------------------------------
  // Google Forms Question-Card Radio/Checkbox Filler
  // -----------------------------------------------------------------------
  // Google Forms renders each question as a card (role="listitem" or class
  // "geS5ne" / "Qr7Oae"). Each card has a title div and a set of choice
  // containers. We iterate cards, match the title to a profile field, then
  // find the option whose text matches the field value and fire the click
  // sequence on the outermost clickable wrapper (the label-like div that
  // Google's Angular listeners actually watch).
  function fillGoogleFormsChoices(container, fields) {
    // Selectors for Google Forms question cards (old + new UI)
    const cardSelectors = [
      '[role="listitem"]',
      '.geS5ne',
      '.Qr7Oae',
      '.freebirdFormviewerViewItemsItemItem',
    ];

    const cards = container !== document
      ? container.querySelectorAll(cardSelectors.join(','))
      : document.querySelectorAll(cardSelectors.join(','));

    console.log(`[FormVault] Google Forms mode: found ${cards.length} question cards.`);

    cards.forEach((card) => {
      // Extract the question title from the card
      const titleEl = card.querySelector(
        '.M7eMe, [role="heading"], .freebirdFormviewerViewItemsItemItemTitle, .freebirdFormeditorViewItemsItemName'
      );
      if (!titleEl) return;
      const questionText = titleEl.textContent.trim();
      if (!questionText) return;

      const matchedField = findMatchingField(questionText, fields);
      if (!matchedField) return;

      console.log(`[FormVault] Question card: "${questionText}" → matched field "${matchedField.label}" = "${matchedField.value}"`);

      // Look for radio/checkbox choice containers within this card
      // Google Forms uses several possible wrapper selectors across versions
      const choiceContainers = card.querySelectorAll(
        '.appsMaterialWizToggleRadiogroupElContainer, ' +
        '.docssharedWizToggleLabeledControl, ' +
        '.freebirdFormviewerViewItemsRadioChoice, ' +
        '.freebirdFormviewerViewItemsCheckboxChoice, ' +
        '[data-value], ' +
        '[role="radio"], ' +
        '[role="checkbox"]'
      );

      console.log(`[FormVault]   Found ${choiceContainers.length} choice containers in card.`);

      let filled = false;
      choiceContainers.forEach((choiceEl) => {
        if (filled) return;

        // Extract the option text from this container
        const optionText = getOptionTextFromContainer(choiceEl);
        console.log(`[FormVault]   Option: "${optionText}"`);

        if (!optionText) return;
        if (!isValueMatch(matchedField.value, optionText)) return;

        // Already selected?
        if (isAlreadySelected(choiceEl)) {
          console.log(`[FormVault]   Already selected: "${optionText}"`);
          filled = true;
          return;
        }

        console.log(`[FormVault]   → Selecting: "${optionText}"`);
        triggerGoogleFormsClick(choiceEl);
        filled = true;
      });

      if (!filled) {
        console.warn(`[FormVault]   No matching option found for value "${matchedField.value}" in question "${questionText}"`);
      }
    });
  }

  // Extract the visible text of a choice container (works for role=radio divs,
  // label-wrapped inputs, and data-value elements)
  function getOptionTextFromContainer(el) {
    // 1. data-value attribute (most reliable in Google Forms)
    const dataVal = el.getAttribute('data-value');
    if (dataVal && dataVal.trim()) return dataVal.trim();

    // 2. aria-label on the element itself
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    // 3. Look for the text label span (Google Forms-specific class)
    const labelSpan = el.querySelector('.YEVVod, .aDTYNe span, .OvPDhc, .WpHeLc span, .nWQGrd span');
    if (labelSpan && labelSpan.textContent.trim()) return labelSpan.textContent.trim();

    // 4. aria-labelledby resolution
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const parts = labelledby.split(/\s+/);
      const texts = parts.map(id => {
        const el2 = document.getElementById(id);
        return el2 ? el2.textContent.trim() : '';
      }).filter(Boolean);
      // If the first resolved ID looks like a question heading, skip it and use rest
      if (texts.length > 1) return texts[texts.length - 1];
      if (texts.length === 1) return texts[0];
    }

    // 5. Last resort: inner text of the element (but trim to avoid entire card text)
    const innerText = el.textContent ? el.textContent.trim() : '';
    // Only return if it's a short string (not the whole card)
    if (innerText && innerText.length < 100) return innerText;

    return '';
  }

  // Check if a choice element is already selected
  function isAlreadySelected(el) {
    if (el.getAttribute('aria-checked') === 'true') return true;
    if (el.classList.contains('isChecked') || el.classList.contains('is-checked')) return true;
    // For standard inputs nested inside
    const input = el.querySelector('input[type="radio"], input[type="checkbox"]');
    if (input && input.checked) return true;
    return false;
  }

  // Fire the correct event sequence for Google Forms' Angular event listeners.
  // Google Forms listens for pointer/mouse events on the outermost wrapper div
  // (the container that has role="radio" or the label div wrapping it).
  function triggerGoogleFormsClick(el) {
    // Walk up to find the outermost clickable container for this choice
    // (Google Forms wraps role="radio" in a div that has the actual listener)
    let target = el;

    // If this IS a role=radio element, its parent container is the real listener target
    if (el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'checkbox') {
      const parent = el.closest(
        '.appsMaterialWizToggleRadiogroupElContainer, ' +
        '.docssharedWizToggleLabeledControl, ' +
        '.freebirdFormviewerViewItemsRadioChoice, ' +
        '.freebirdFormviewerViewItemsCheckboxChoice'
      );
      if (parent) target = parent;
    }

    // Fire the full pointer/mouse event sequence
    const pointerOpts = { bubbles: true, cancelable: true, view: window };
    target.dispatchEvent(new PointerEvent('pointerover', pointerOpts));
    target.dispatchEvent(new PointerEvent('pointerenter', pointerOpts));
    target.dispatchEvent(new MouseEvent('mouseover', pointerOpts));
    target.dispatchEvent(new MouseEvent('mouseenter', pointerOpts));
    target.dispatchEvent(new PointerEvent('pointermove', pointerOpts));
    target.dispatchEvent(new MouseEvent('mousemove', pointerOpts));
    target.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
    target.dispatchEvent(new MouseEvent('mousedown', pointerOpts));
    target.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
    target.dispatchEvent(new MouseEvent('mouseup', pointerOpts));
    target.click();
    target.dispatchEvent(new MouseEvent('click', pointerOpts));

    // Also try clicking any nested role=radio/checkbox just in case
    const inner = target.querySelector('[role="radio"], [role="checkbox"]');
    if (inner && inner !== el) {
      inner.dispatchEvent(new MouseEvent('mousedown', pointerOpts));
      inner.dispatchEvent(new MouseEvent('mouseup', pointerOpts));
      inner.click();
    }

    // Dispatch change/input for framework binding
    target.dispatchEvent(new Event('change', { bubbles: true }));
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // -----------------------------------------------------------------------
  // Helper functions (kept for standard HTML forms)
  // -----------------------------------------------------------------------

  // Traverse up to find the question label for radio, checkbox, or dropdown elements
  function getQuestionLabelForChoice(el) {
    let parent = el.parentElement;
    for (let i = 0; i < 6 && parent; i++) {
      if (parent.classList.contains('geS5ne') || parent.getAttribute('role') === 'listitem') {
        const titleEl = parent.querySelector('.M7eMe, [role="heading"]');
        if (titleEl && titleEl.textContent) return titleEl.textContent.trim();
        break;
      }
      if (parent.tagName.toLowerCase() === 'fieldset') {
        const legend = parent.querySelector('legend');
        if (legend && legend.textContent) return legend.textContent.trim();
      }
      parent = parent.parentElement;
    }
    parent = el.parentElement;
    for (let i = 0; i < 4 && parent; i++) {
      const titleEl = parent.querySelector('[role="heading"], .M7eMe, legend, label:not([for])');
      if (titleEl && titleEl.textContent) return titleEl.textContent.trim();
      parent = parent.parentElement;
    }
    return '';
  }

  // Extract the label/text for a specific radio or checkbox option (standard HTML)
  function getOptionLabel(el) {
    const dataVal = el.getAttribute('data-value');
    if (dataVal) return dataVal.trim();
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    if (el.id) {
      const labelEl = document.querySelector(`label[for="${el.id}"]`);
      if (labelEl) return labelEl.textContent.trim();
    }
    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.textContent.trim();
    if (el.textContent && el.textContent.trim()) return el.textContent.trim();
    const parent = el.parentElement;
    if (parent) {
      const text = parent.textContent || '';
      if (text.trim()) return text.trim();
    }
    return '';
  }

  // Check if a standard HTML radio/checkbox is selected
  function isChoiceSelected(el) {
    if (el.tagName.toLowerCase() === 'input') return el.checked;
    return el.getAttribute('aria-checked') === 'true' || el.classList.contains('is-checked');
  }

  // Parse a date string of various formats into YYYY-MM-DD
  function parseDateString(str) {
    if (!str) return null;
    str = str.trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return str;
    }

    const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmyMatch) {
      const day = dmyMatch[1].padStart(2, '0');
      const month = dmyMatch[2].padStart(2, '0');
      const year = dmyMatch[3];
      return `${year}-${month}-${day}`;
    }

    const ymdMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (ymdMatch) {
      const year = ymdMatch[1];
      const month = ymdMatch[2].padStart(2, '0');
      const day = ymdMatch[3].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    try {
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    } catch (e) {}

    return null;
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
      'college': ['college', 'university', 'school', 'institute', 'roll number', 'roll no', 'registration no', 'enrollment'],
      'date': ['date', 'dob', 'date of birth', 'birthdate', 'birth']
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
      if (input.type === 'date') {
        const normalizedDate = parseDateString(value);
        if (normalizedDate) {
          input.value = normalizedDate;
        } else {
          input.value = value;
        }
      } else {
        input.value = value;
      }
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
