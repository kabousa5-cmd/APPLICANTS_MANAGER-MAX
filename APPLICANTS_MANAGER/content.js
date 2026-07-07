// content.js - Click on group name to show applicants
(() => {
    'use strict';

    console.log('🔧 BLS Extension loaded on:', window.location.href);

    // --- Message Listener for Extension Popup ---
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log('📨 Message received:', request);
        
        if (request.action === 'fillForm') {
            fillForm(request.applicant);
            sendResponse({ success: true });
        } else if (request.action === 'openAppointments') {
            createMyAppointmentsPopup();
            sendResponse({ success: true });
        } else if (request.action === 'injectPhoto') {
            injectPhoto(request.applicant);
            sendResponse({ success: true });
        }
        
        return true;
    });

    // --- Page Detection ---
    const currentUrl = window.location.href.toLowerCase();
    const isBLSWebsite = currentUrl.includes('blsspainmorocco.net') || currentUrl.includes('morocco.blsportugal.com');
    const isSpecificManagePage = isBLSWebsite && 
                                currentUrl.includes('appointmentdata') && 
                                (currentUrl.includes('manageapplicant') || currentUrl.includes('manage-applicant'));
    const isSlotPage = currentUrl.includes('slotselection');
    const isApplicantPage = currentUrl.includes('applicantselection');

    console.log('🔍 Page detection:', { currentUrl, isBLSWebsite, isSpecificManagePage, isSlotPage, isApplicantPage });

    // If inside ApplicantSelection iframe
    if (isApplicantPage && window.top !== window.self) {
        try { 
            window.parent.postMessage('slot-available', location.origin); 
        } catch (e) {
            console.error('Error sending message to parent:', e);
        }
        return;
    }

    // Run appropriate automation
    if (isSlotPage) {
        initializeSlotAutomation();
    } else if (isApplicantPage) {
        initializeApplicantAutoFill();
        initCopyApplicantNameIcons(); // isolated feature - adds 📋 next to applicant name on the BLS selection card
    } else if (isSpecificManagePage) {
        initializeManageApplicantPage();
    }

    // ── COPY APPLICANT NAME ADD-ON ───────────────────────────────────────
    // Isolated feature, does not touch the auto-fill flow above.
    // Adds a 📋 icon in front of the applicant name on the BLS
    // "Please select your applicant from below list" card (div.bls-applicant).
    // Click the icon -> copies that applicant's full name to clipboard.
    function initCopyApplicantNameIcons() {
        const PROCESSED_ATTR = 'data-copy-icon-added';

        function copyTextToClipboard(text) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
            } else {
                fallbackCopy(text);
            }
            function fallbackCopy(t) {
                try {
                    const ta = document.createElement('textarea');
                    ta.value = t;
                    ta.style.position = 'fixed';
                    ta.style.left = '-9999px';
                    document.body.appendChild(ta);
                    ta.focus();
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                } catch (e) {
                    console.warn('[Copy Name Add-on] fallback copy failed:', e);
                }
            }
        }

        function flashIcon(icon) {
            const original = icon.textContent;
            icon.textContent = '✅';
            setTimeout(() => { icon.textContent = original; }, 900);
        }

        // Finds the applicant name <span> inside each BLS applicant card.
        // Real markup (confirmed via DOM inspection):
        //   <div class="bls-applicant alert ..." onclick="OnApplicantSelect(...)">
        //     <div class="row col-10">
        //       <div class="col-12 pb-1"><span>YOUSSEF CHRAIBI</span></div>
        //       <div class="col-12">Date Of Birth: ...</div>
        //       ...
        function findApplicantNameElements() {
            const found = [];
            let cards = document.querySelectorAll('.bls-applicant');
            if (cards.length === 0) {
                cards = document.querySelectorAll('[onclick*="OnApplicantSelect"]');
            }
            for (const card of cards) {
                let nameSpan = card.querySelector('.col-12.pb-1 span') || card.querySelector('span');
                if (nameSpan && nameSpan.textContent.trim().length > 1) {
                    found.push(nameSpan);
                }
            }
            return found;
        }

        function addCopyIcons() {
            const nameEls = findApplicantNameElements();

            for (const nameEl of nameEls) {
                if (nameEl.getAttribute(PROCESSED_ATTR)) continue;
                nameEl.setAttribute(PROCESSED_ATTR, '1');

                const fullName = (nameEl.textContent || '').trim();

                const icon = document.createElement('span');
                icon.textContent = '📋';
                icon.title = fullName;
                icon.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    margin-right: 8px;
                    cursor: pointer;
                    opacity: 0.85;
                    font-size: 1.4em;
                    line-height: 1;
                    vertical-align: middle;
                    user-select: none;
                `;

                icon.addEventListener('mouseenter', () => { icon.style.opacity = '1'; });
                icon.addEventListener('mouseleave', () => { icon.style.opacity = '0.85'; });

                icon.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    copyTextToClipboard(fullName);
                    flashIcon(icon);
                });

                nameEl.insertBefore(icon, nameEl.firstChild);
            }
        }

        // Card renders dynamically (after OTP + travel date entry), keep watching
        addCopyIcons();
        const observer = new MutationObserver(() => addCopyIcons());
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    // --- Manage Applicant Page Functions ---
    function initializeManageApplicantPage() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(showApplicantsOnManagePage, 1000);
            });
        } else {
            setTimeout(showApplicantsOnManagePage, 1000);
        }
    }

    function showApplicantsOnManagePage() {
        chrome.storage.local.get(['bls_applicants'], (result) => {
            const applicants = result.bls_applicants || [];
            
            if (applicants.length > 0) {
                createApplicantsListOnManagePage(applicants);
            } else {
                showTempMessage('❌ No applicants found. Please add applicants in the extension popup.', 'error');
            }
        });
    }

    function createApplicantsListOnManagePage(applicants) {
        // Remove existing panel
        const existingPanel = document.getElementById('applicants-manage-panel');
        if (existingPanel) existingPanel.remove();

        // Create panel
        const panel = document.createElement('div');
        panel.id = 'applicants-manage-panel';
        panel.style.cssText = `
            background: #2c3e50;
            color: white;
            padding: 20px;
            margin: 20px;
            border-radius: 12px;
            font-family: system-ui;
            border-left: 6px solid #3498db;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            position: relative;
            z-index: 9999;
            border: 2px solid #34495e;
        `;

        // Group applicants
        const grouped = {};
        applicants.forEach((applicant, index) => {
            const groupName = applicant.group || 'Ungrouped';
            if (!grouped[groupName]) {
                grouped[groupName] = [];
            }
            grouped[groupName].push({ applicant, index });
        });

        panel.innerHTML = `
            <div style="margin-bottom: 15px; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;">
                <div>
                    <h4 style="margin: 0; color: white; font-size: 18px; display: flex; align-items: center; gap: 10px;">
                        👥 Your Applicants (${applicants.length}) 
                    </h4>
                    <div style="font-size: 13px; opacity: 0.9; margin-top: 8px; color: #ecf0f1;">
                        Select a group, then click any name to auto-fill and submit
                    </div>
                </div>
                <button id="applicants-sync-btn" style="
                    background: #27ae60;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    padding: 8px 14px;
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 600;
                    font-family: system-ui;
                    white-space: nowrap;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    transition: all 0.2s ease;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                ">🔄 Sync</button>
            </div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 15px;">
                ${Object.keys(grouped).sort().map((groupName, idx) => {
                    const groupApplicants = grouped[groupName];
                    const isFirst = idx === 0;
                    const headerBg = isFirst ? '#3498db' : '#7f8c8d';
                    return `
                        <button class="group-header-clickable" data-group="${groupName}" style="
                            color: white; 
                            font-size: 14px; 
                            font-weight: 600;
                            display: inline-flex; 
                            align-items: center; 
                            gap: 8px;
                            cursor: pointer;
                            padding: 10px 18px;
                            border-radius: 6px;
                            transition: all 0.3s ease;
                            background: ${headerBg};
                            border: none;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                        ">
                            📁 ${groupName.toUpperCase()} (${groupApplicants.length})
                        </button>
                    `;
                }).join('')}
            </div>
            ${Object.keys(grouped).sort().map((groupName, idx) => {
                const groupApplicants = grouped[groupName];
                const isFirst = idx === 0;
                const displayStyle = isFirst ? 'flex' : 'none';
                return `
                    <div class="group-applicants-container" data-group="${groupName}" style="
                        display: ${displayStyle};
                        flex-wrap: wrap; 
                        gap: 8px;
                        margin-bottom: 15px;
                    ">
                        ${groupApplicants.map(({ applicant, index }) => `
                            <button class="applicant-btn" data-index="${index}" style="
                                background: #34495e;
                                color: white;
                                border: none;
                                border-radius: 25px;
                                padding: 10px 18px;
                                cursor: pointer;
                                font-size: 13px;
                                font-family: system-ui;
                                transition: all 0.3s ease;
                                border: 2px solid transparent;
                                white-space: nowrap;
                                min-width: 120px;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                gap: 5px;
                            ">
                                ${applicant.FirstName} ${applicant.LastName}${applicant.photo ? ' 📷' : ''}
                            </button>
                        `).join('')}
                    </div>
                `;
            }).join('')}
        `;

        // Insert panel
        const insertionPoints = [document.querySelector('form'), document.querySelector('.container'), document.body];
        for (const point of insertionPoints) {
            if (point && point.parentNode) {
                try {
                    point.parentNode.insertBefore(panel, point);
                    break;
                } catch (e) {}
            }
        }

        // Sync button - re-pulls applicants from the server and refreshes this panel without a page reload
        const syncBtn = panel.querySelector('#applicants-sync-btn');
        if (syncBtn) {
            syncBtn.addEventListener('mouseenter', () => {
                syncBtn.style.background = '#229954';
                syncBtn.style.transform = 'translateY(-1px)';
            });
            syncBtn.addEventListener('mouseleave', () => {
                syncBtn.style.background = '#27ae60';
                syncBtn.style.transform = 'translateY(0)';
            });
            syncBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                syncBtn.disabled = true;
                syncBtn.textContent = '⏳ Syncing...';

                chrome.runtime.sendMessage({ action: 'syncNow' }, (response) => {
                    chrome.storage.local.get(['bls_applicants'], (result) => {
                        const refreshed = result.bls_applicants || [];

                        if (response && response.success) {
                            showTempMessage(`✅ Synced - ${refreshed.length} applicant(s)`, 'success');
                        } else {
                            showTempMessage('❌ Sync failed - showing cached applicants', 'error');
                        }

                        if (refreshed.length > 0) {
                            createApplicantsListOnManagePage(refreshed);
                        } else {
                            syncBtn.disabled = false;
                            syncBtn.textContent = '🔄 Sync';
                        }
                    });
                });
            });
        }

        // Add event listeners to group headers
        const groupHeaders = panel.querySelectorAll('.group-header-clickable');
        groupHeaders.forEach(header => {
            const groupName = header.dataset.group;
            const container = panel.querySelector(`.group-applicants-container[data-group="${groupName}"]`);
            
            header.addEventListener('click', () => {
                // Hide all containers first
                const allContainers = panel.querySelectorAll('.group-applicants-container');
                allContainers.forEach(c => c.style.display = 'none');
                
                // Reset all headers to gray
                groupHeaders.forEach(h => h.style.background = '#7f8c8d');
                
                // Show clicked container and set header to blue
                container.style.display = 'flex';
                header.style.background = '#3498db';
            });

            header.addEventListener('mouseenter', () => {
                const isActive = container.style.display === 'flex';
                header.style.background = isActive ? '#2980b9' : '#6c757d';
                header.style.transform = 'translateX(5px)';
            });

            header.addEventListener('mouseleave', () => {
                const isActive = container.style.display === 'flex';
                header.style.background = isActive ? '#3498db' : '#7f8c8d';
                header.style.transform = 'translateX(0)';
            });
        });

        // Add event listeners to all applicant buttons
        const applicantButtons = panel.querySelectorAll('.applicant-btn');
        applicantButtons.forEach(btn => {
            const index = parseInt(btn.dataset.index);
            const applicant = applicants[index];
            
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('🖱️ Clicked applicant:', applicant.FirstName, 'Index:', index);
                selectAndSubmitApplicant(index, applicant);
            });

            btn.addEventListener('mouseenter', () => {
                btn.style.background = '#e67e22';
                btn.style.transform = 'translateY(-2px)';
            });

            btn.addEventListener('mouseleave', () => {
                btn.style.background = '#34495e';
                btn.style.transform = 'translateY(0)';
            });
        });
    }

    function selectAndSubmitApplicant(index, applicant) {
        console.log('🚀 Starting auto-fill and submit for:', applicant.FirstName, 'Index:', index);
        
        // Save the selected applicant index for auto-fill
        chrome.storage.local.set({ bls_last_selected: index }, () => {
            console.log('💾 Saved selected applicant for auto-fill:', index, applicant.FirstName);
            
            // Fill the form with applicant data
            console.log('📝 Filling form...');
            const fillSuccess = fillForm(applicant);
            
            // Wait a bit before injecting photo to ensure form is ready
            setTimeout(() => {
                const photoSuccess = injectPhoto(applicant);
                console.log('📷 Photo injection result:', photoSuccess);
            }, 500);
            
            if (!fillSuccess) {
                showTempMessage('❌ Failed to fill form fields', 'error');
                return;
            }
            
            setupEnterKeyNavigation();
            showTempMessage(`✅ Filled form for ${applicant.FirstName}. Submitting...`, 'success');
            
            setTimeout(() => {
                const submitBtn = findSubmitButton();
                if (submitBtn) {
                    submitBtn.click();
                    console.log('✅ Submission completed - selection preserved for next page auto-fill');
                } else {
                    showTempMessage('❌ Submit button not found', 'error');
                }
            }, 1000);
        });
    }

    // --- Applicant Selection Page Auto-fill ---
    function initializeApplicantAutoFill() {
        // Add PHOTO APPLICANT button on the left
        setTimeout(() => {
            const existingBtn = document.getElementById('applicant-photo-left-btn');
            if (existingBtn) existingBtn.remove();
            
            const photoBtn = document.createElement('button');
            photoBtn.id = 'applicant-photo-left-btn';
            photoBtn.textContent = '📷 PHOTO APPLICANT';
            photoBtn.style.cssText = `
                position: fixed;
                top: 50%;
                left: 20px;
                transform: translateY(-50%);
                z-index: 9999;
                background: #9b59b6;
                color: white;
                padding: 12px 16px;
                border: none;
                border-radius: 8px;
                font-family: system-ui;
                font-size: 14px;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                font-weight: bold;
                transition: all 0.3s ease;
            `;
            
            photoBtn.addEventListener('mouseenter', () => {
                photoBtn.style.background = '#8e44ad';
                photoBtn.style.transform = 'translateY(-50%) scale(1.05)';
            });
            
            photoBtn.addEventListener('mouseleave', () => {
                photoBtn.style.background = '#9b59b6';
                photoBtn.style.transform = 'translateY(-50%) scale(1)';
            });
            
            photoBtn.onclick = createGroupPhotosPopup;
            document.body.appendChild(photoBtn);
        }, 1000);

        // Add MY GROUPS button on the right - opens group selector
        setTimeout(() => {
            const existingBtn = document.getElementById('my-groups-right-btn');
            if (existingBtn) existingBtn.remove();
            
            const groupsBtn = document.createElement('button');
            groupsBtn.id = 'my-groups-right-btn';
            groupsBtn.textContent = '👥 MY GROUPS';
            groupsBtn.style.cssText = `
                position: fixed;
                top: 50%;
                right: 20px;
                transform: translateY(-50%);
                z-index: 9999;
                background: #2980b9;
                color: white;
                padding: 12px 16px;
                border: none;
                border-radius: 8px;
                font-family: system-ui;
                font-size: 14px;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                font-weight: bold;
                transition: all 0.3s ease;
            `;
            
            groupsBtn.addEventListener('mouseenter', () => {
                groupsBtn.style.background = '#21618c';
                groupsBtn.style.transform = 'translateY(-50%) scale(1.05)';
            });
            
            groupsBtn.addEventListener('mouseleave', () => {
                groupsBtn.style.background = '#2980b9';
                groupsBtn.style.transform = 'translateY(-50%) scale(1)';
            });
            
            groupsBtn.onclick = createMyGroupsPopup;
            document.body.appendChild(groupsBtn);
        }, 1000);
        
        // Auto-fill only if there's a selected applicant, then CLEAR it after auto-fill
        setTimeout(() => {
            chrome.storage.local.get(['bls_applicants', 'bls_last_selected', 'bls_autofill_enabled'], (result) => {
                const applicants = result.bls_applicants || [];
                const lastSelected = result.bls_last_selected;
                const autofillEnabled = result.bls_autofill_enabled !== 'off';
                
                console.log('🔧 Auto-fill check:', { 
                    lastSelected, 
                    applicantsCount: applicants.length,
                    autofillEnabled,
                    selectedApplicant: lastSelected !== null && lastSelected !== undefined ? applicants[lastSelected] : null
                });
                
                // Only auto-fill if there's a selected applicant
                if (autofillEnabled && lastSelected !== null && lastSelected !== undefined && applicants[lastSelected]) {
                    console.log('✅ Auto-filling with:', applicants[lastSelected].FirstName);
                    
                    // Fill form first
                    const fillSuccess = fillForm(applicants[lastSelected]);
                    
                    // Wait and then inject photo with more delay
                    setTimeout(() => {
                        const photoSuccess = injectPhoto(applicants[lastSelected]);
                        console.log('📷 Auto-fill photo injection result:', photoSuccess);
                        
                        if (fillSuccess || photoSuccess) {
                            showTempMessage(`✅ Auto-filled with ${applicants[lastSelected].FirstName}`, 'success');
                            
                            // Clear the selection AFTER auto-filling on ApplicantSelection page
                            setTimeout(() => {
                                chrome.storage.local.set({ bls_last_selected: null }, () => {
                                    console.log('🗑️ Cleared selection after auto-fill on ApplicantSelection page');
                                    showTempMessage('🔄 Auto-fill completed - ready for next applicant', 'info');
                                });
                            }, 3000);
                        }
                    }, 1000);
                } else {
                    console.log('🚫 No auto-fill: No selected applicant or auto-fill disabled');
                }
            });
        }, 2000);

        // Auto click "Understood" button
        window.addEventListener("load", () => {
            setTimeout(() => {
                const btn = document.querySelector("button.btn.btn-primary[data-bs-dismiss='modal'][onclick^='return OnPhotoAccepted']");
                if (btn) {
                    btn.click();
                    console.log("✅ Auto clicked 'Understood' button on ApplicantSelection");
                }
            }, 2500);
        });
    }

    // --- Shared Functions ---

    // Try to find an input/select/textarea by matching its visible <label> text.
    // Used as a last-resort fallback when id/name guesses fail (e.g. Address & Contact Details section).
    function findFieldByLabel(labelText) {
        const normalize = s => (s || '').replace(/[\*\u00A0]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
        const target = normalize(labelText);
        if (!target) return null;

        const candidates = document.querySelectorAll('label, td, th, div, span');
        let startsWithMatch = null;

        for (const el of candidates) {
            // Skip elements with too much nested text (likely containers, not labels)
            if (el.children.length > 3) continue;

            const text = normalize(el.textContent);
            if (!text) continue;

            const isExact = text === target;
            const isStart = !isExact && text.startsWith(target) && text.length < target.length + 5;
            if (!isExact && !isStart) continue;

            // 1) <label for="...">
            if (el.tagName === 'LABEL' && el.htmlFor) {
                const byFor = document.getElementById(el.htmlFor);
                if (byFor) { if (isExact) return byFor; if (!startsWithMatch) startsWithMatch = byFor; }
            }

            // 2) Input nested inside the label/container itself
            let input = el.querySelector('input, select, textarea');
            if (input) { if (isExact) return input; if (!startsWithMatch) startsWithMatch = input; }

            // 3) Walk forward through siblings (label then input as sibling elements)
            let sib = el.nextElementSibling;
            for (let i = 0; i < 4 && sib; i++, sib = sib.nextElementSibling) {
                input = sib.matches && sib.matches('input, select, textarea') ? sib : sib.querySelector?.('input, select, textarea');
                if (input) { if (isExact) return input; if (!startsWithMatch) startsWithMatch = input; break; }
            }

            // 4) Walk forward through the parent's siblings (grid/table layout: label cell, then input cell)
            const parent = el.parentElement;
            if (parent) {
                let psib = parent.nextElementSibling;
                for (let i = 0; i < 4 && psib; i++, psib = psib.nextElementSibling) {
                    input = psib.matches && psib.matches('input, select, textarea') ? psib : psib.querySelector?.('input, select, textarea');
                    if (input) { if (isExact) return input; if (!startsWithMatch) startsWithMatch = input; break; }
                }
            }
        }

        return startsWithMatch;
    }

    function fillForm(applicant) {
        console.log('📝 Filling form for:', applicant.FirstName);
        let filledFields = 0;
        try {
            const fields = [
                { id: 'FirstName', value: applicant.FirstName },
                { id: 'LastName', value: applicant.LastName },
                { id: 'PassportNo', value: applicant.PassportNo },
                { id: 'PlaceOfBirth', value: applicant.PlaceOfBirth },
                { id: 'IssuePlace', value: applicant.IssuePlace },
                { id: 'DateOfBirth', value: applicant.DateOfBirth },
                // --- Address & Contact Details (section 4 on BLS form) ---
                {
                    id: 'HomeAddressLine1',
                    altIds: ['AddressLine1', 'Address1', 'HomeAddress', 'Address'],
                    label: 'Home Address Line1',
                    value: applicant.HomeAddressLine1
                },
                {
                    id: 'City',
                    altIds: ['CityName', 'HomeCity', 'AddressCity'],
                    label: 'City',
                    value: applicant.City
                },
                {
                    id: 'PostalCode',
                    altIds: ['Pincode', 'PostCode', 'Zip', 'ZipCode'],
                    label: 'Postal Code',
                    value: applicant.PostalCode
                }
            ];

            fields.forEach(field => {
                if (!field.value) return;

                let el = document.getElementById(field.id);

                if (!el) {
                    el = document.querySelector(`input[name="${field.id}"]`) ||
                         document.querySelector(`input[name*="${field.id}"]`) ||
                         document.querySelector(`input[name*="${field.id.toLowerCase()}"]`);
                }

                // Try alternate ids/names (Address & Contact Details fields may use different naming on BLS)
                if (!el && Array.isArray(field.altIds)) {
                    for (const altId of field.altIds) {
                        el = document.getElementById(altId) ||
                             document.querySelector(`input[name="${altId}"]`) ||
                             document.querySelector(`input[name*="${altId}"]`) ||
                             document.querySelector(`input[name*="${altId.toLowerCase()}"]`);
                        if (el) break;
                    }
                }

                // Last resort: match by the visible label text on the page
                if (!el && field.label) {
                    el = findFieldByLabel(field.label);
                }

                if (el) {
                    console.log(`✅ Filling ${field.id} with:`, field.value, '→', el.id || el.name || '(no id/name)');
                    el.value = field.value;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    filledFields++;
                } else {
                    console.log(`❌ Field ${field.id} not found`);
                }
            });

            console.log(`✅ Filled ${filledFields} fields for ${applicant.FirstName}`);
            return filledFields > 0;
        } catch (e) {
            console.warn("❌ Error autofilling:", e);
            return false;
        }
    }

    function injectPhoto(applicant) {
        if (!applicant || !applicant.photo) {
            console.log('📷 No photo to inject for:', applicant?.FirstName);
            return false;
        }
        
        console.log('📷 Injecting photo for:', applicant.FirstName);
        
        try {
            const photoSelectors = [
                '#uploadfile-1',
                '#uploadfile1',
                'input[type="file"]',
                'input[type="file"][accept*="image"]',
                'input[type="file"][accept*="jpg"]',
                'input[type="file"][accept*="jpeg"]',
                'input[type="file"][accept*="png"]',
                'input[name*="photo"]',
                'input[name*="file"]',
                'input[name*="upload"]',
                'input[class*="file"]',
                'input[class*="upload"]'
            ];
            
            let fileInput = null;
            for (const selector of photoSelectors) {
                fileInput = document.querySelector(selector);
                if (fileInput) {
                    console.log('✅ Found file input with selector:', selector);
                    break;
                }
            }
            
            if (!fileInput) {
                console.log('❌ No file input found with any selector');
                const allInputs = document.querySelectorAll('input');
                for (const input of allInputs) {
                    if (input.type === 'file') {
                        fileInput = input;
                        console.log('✅ Found file input by scanning all inputs');
                        break;
                    }
                }
            }
            
            if (fileInput) {
                console.log('📸 Processing photo data...');
                
                const base64Data = applicant.photo.split(',')[1];
                const mimeType = applicant.photo.split(',')[0].split(':')[1].split(';')[0];
                
                console.log('📸 MIME type:', mimeType);
                
                const byteCharacters = atob(base64Data);
                const byteNumbers = new Array(byteCharacters.length);
                
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: mimeType });
                const file = new File([blob], "applicant_photo.jpg", { 
                    type: mimeType, 
                    lastModified: new Date().getTime() 
                });

                console.log('📸 Created file:', file.name, file.size, 'bytes');

                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                
                fileInput.files = dataTransfer.files;
                console.log('📸 Set files to input, file count:', fileInput.files.length);

                const events = ['change', 'input', 'blur', 'focus', 'click'];
                events.forEach(eventType => {
                    const event = new Event(eventType, { 
                        bubbles: true, 
                        cancelable: true 
                    });
                    fileInput.dispatchEvent(event);
                });

                const propEvent = new Event('propertychange', { bubbles: true });
                fileInput.dispatchEvent(propEvent);

                console.log('✅ Photo injected successfully for:', applicant.FirstName);
                
                setTimeout(() => {
                    const previewSelectors = [
                        '#uploadfile-1-preview',
                        '.preview img',
                        'img[src*="upload"]',
                        'img[src*="preview"]',
                        '.file-preview',
                        '.image-preview'
                    ];
                    
                    for (const selector of previewSelectors) {
                        const preview = document.querySelector(selector);
                        if (preview) {
                            preview.src = applicant.photo;
                            console.log('✅ Updated photo preview with selector:', selector);
                            break;
                        }
                    }
                }, 100);

                return true;
                
            } else {
                console.log('❌ No file input found on this page');
                return false;
            }
            
        } catch (e) {
            console.warn('❌ Error injecting photo:', e);
            return false;
        }
    }

    function setupEnterKeyNavigation() {
        const formInputs = document.querySelectorAll('input[type="text"], input[type="date"], input[type="number"], select, textarea');
        
        formInputs.forEach((input, index) => {
            input.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const nextIndex = index + 1;
                    if (nextIndex < formInputs.length) {
                        formInputs[nextIndex].focus();
                    } else {
                        const submitBtn = findSubmitButton();
                        if (submitBtn) submitBtn.click();
                    }
                }
            });
        });
    }

    function findSubmitButton() {
        const selectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            '.btn-primary',
            'button.btn-primary',
            'button[onclick*="submit"]',
            'button[onclick*="Save"]',
            'button[onclick*="save"]',
            'input[value*="Submit"]',
            'input[value*="Save"]'
        ];
        
        for (const selector of selectors) {
            const btn = document.querySelector(selector);
            if (btn) {
                console.log('✅ Found submit button with selector:', selector);
                return btn;
            }
        }
        
        const buttons = document.querySelectorAll('button, input[type="button"]');
        for (const btn of buttons) {
            const text = btn.textContent || btn.value || '';
            if (text.match(/submit|save|update|confirm|next|continue/i)) {
                console.log('✅ Found submit button by text:', text);
                return btn;
            }
        }
        
        console.log('❌ No submit button found with any selector');
        return null;
    }

    function showTempMessage(message, type) {
        const existingMsg = document.getElementById('temp-message');
        if (existingMsg) existingMsg.remove();

        const messageEl = document.createElement('div');
        messageEl.id = 'temp-message';
        messageEl.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10001;
            background: ${type === 'success' ? '#27ae60' : type === 'error' ? '#e74c3c' : '#3498db'};
            color: white;
            padding: 12px 16px;
            border-radius: 6px;
            font-family: system-ui;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        messageEl.textContent = message;
        
        document.body.appendChild(messageEl);
        setTimeout(() => { if (messageEl.parentNode) messageEl.remove(); }, 3000);
    }

    // Helper function to read file as data URL
    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // NEW FUNCTION: Create Group Photos Popup (organized by groups)
    function createGroupPhotosPopup() {
        const existingPopup = document.getElementById("group-photos-popup");
        if (existingPopup) {
            existingPopup.remove();
            return;
        }

        chrome.storage.local.get(['bls_applicants'], (result) => {
            const applicants = result.bls_applicants || [];
            
            if (applicants.length === 0) {
                showTempMessage('❌ No applicants found. Please add applicants in the extension.', 'error');
                return;
            }

            // Group applicants
            const grouped = {};
            applicants.forEach((applicant, index) => {
                const groupName = applicant.group || 'Ungrouped';
                if (!grouped[groupName]) {
                    grouped[groupName] = [];
                }
                grouped[groupName].push({ applicant, index });
            });

            const popup = document.createElement("div");
            popup.id = "group-photos-popup";
            popup.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 90%;
                max-width: 700px;
                max-height: 80vh;
                background: white;
                border: 3px solid #9b59b6;
                border-radius: 12px;
                box-shadow: 0 0 30px rgba(0,0,0,0.5);
                z-index: 10001;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            `;

            popup.innerHTML = `
                <div style="background: #9b59b6; color: white; padding: 15px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3 style="margin: 0; font-size: 18px;">📷 Photo Applicants</h3>
                        <div style="font-size: 12px; opacity: 0.9; margin-top: 3px;">Select a group to view photos</div>
                    </div>
                    <button id="close-photo-popup" style="background: none; border: none; color: white; font-size: 24px; cursor: pointer; padding: 0; width: 35px; height: 35px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: background 0.3s;">×</button>
                </div>
                <div style="padding: 15px; border-bottom: 2px solid #ecf0f1;">
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        ${Object.keys(grouped).sort().map((groupName, idx) => {
                            const groupApplicants = grouped[groupName];
                            const isFirst = idx === 0;
                            const headerBg = isFirst ? '#9b59b6' : '#95a5a6';
                            return `
                                <button class="photo-group-btn" data-group="${groupName}" style="
                                    color: white; 
                                    font-size: 14px; 
                                    font-weight: 600;
                                    display: inline-flex; 
                                    align-items: center; 
                                    gap: 8px;
                                    cursor: pointer;
                                    padding: 10px 18px;
                                    border-radius: 6px;
                                    transition: all 0.3s ease;
                                    background: ${headerBg};
                                    border: none;
                                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                                ">
                                    📁 ${groupName.toUpperCase()} (${groupApplicants.length})
                                </button>
                            `;
                        }).join('')}
                    </div>
                </div>
                <div style="flex: 1; overflow-y: auto; padding: 15px;">
                    ${Object.keys(grouped).sort().map((groupName, idx) => {
                        const groupApplicants = grouped[groupName];
                        const isFirst = idx === 0;
                        const displayStyle = isFirst ? 'block' : 'none';
                        return `
                            <div class="photo-group-container" data-group="${groupName}" style="display: ${displayStyle};">
                                ${groupApplicants.map(({ applicant, index }) => {
                                    const hasPhoto = applicant.photo ? true : false;
                                    return `
                                        <div class="applicant-photo-item" data-index="${index}" style="
                                            display: flex;
                                            align-items: center;
                                            padding: 12px;
                                            border-bottom: 1px solid #ecf0f1;
                                            transition: all 0.3s ease;
                                            gap: 12px;
                                        ">
                                            <div style="
                                                width: 70px;
                                                height: 70px;
                                                border-radius: 8px;
                                                overflow: hidden;
                                                border: 2px solid #9b59b6;
                                                flex-shrink: 0;
                                                background: #f8f9fa;
                                                display: flex;
                                                align-items: center;
                                                justify-content: center;
                                                cursor: pointer;
                                            " class="photo-container">
                                                ${hasPhoto ? 
                                                    `<img src="${applicant.photo}" style="width: 100%; height: 100%; object-fit: cover;">` : 
                                                    `<span style="font-size: 28px;">👤</span>`
                                                }
                                            </div>
                                            <div style="flex: 1;">
                                                <div style="font-weight: bold; font-size: 14px; color: #2c3e50; margin-bottom: 4px;">
                                                    ${applicant.FirstName} ${applicant.LastName}
                                                </div>
                                                <div style="font-size: 12px; color: #7f8c8d;">
                                                    ${applicant.PassportNo || 'No passport'}
                                                </div>
                                                <div style="font-size: 10px; color: #95a5a6; margin-top: 2px;">
                                                    ${hasPhoto ? '📷 Click photo to inject' : '❌ No photo - Click to add'}
                                                </div>
                                            </div>
                                            <button class="change-photo-btn" data-index="${index}" style="
                                                background: #3498db;
                                                color: white;
                                                border: none;
                                                border-radius: 5px;
                                                padding: 7px 10px;
                                                font-size: 10px;
                                                cursor: pointer;
                                                transition: all 0.3s;
                                                white-space: nowrap;
                                                font-weight: 600;
                                            ">🔄 Change</button>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `;
                    }).join('')}
                </div>
            `;

            const overlay = document.createElement("div");
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.6);
                z-index: 10000;
            `;

            document.body.appendChild(overlay);
            document.body.appendChild(popup);

            // Add group button click handlers
            const photoGroupBtns = popup.querySelectorAll('.photo-group-btn');
            photoGroupBtns.forEach(btn => {
                const groupName = btn.dataset.group;
                const container = popup.querySelector(`.photo-group-container[data-group="${groupName}"]`);
                
                btn.addEventListener('click', () => {
                    // Hide all containers
                    const allContainers = popup.querySelectorAll('.photo-group-container');
                    allContainers.forEach(c => c.style.display = 'none');
                    
                    // Reset all buttons to gray
                    photoGroupBtns.forEach(b => b.style.background = '#95a5a6');
                    
                    // Show clicked container and set button to purple
                    container.style.display = 'block';
                    btn.style.background = '#9b59b6';
                });
            });

            // Close button functionality
            const closeBtn = document.getElementById("close-photo-popup");
            closeBtn.addEventListener('mouseenter', () => {
                closeBtn.style.background = 'rgba(255,255,255,0.2)';
            });
            closeBtn.addEventListener('mouseleave', () => {
                closeBtn.style.background = 'none';
            });
            closeBtn.onclick = overlay.onclick = () => {
                popup.remove();
                overlay.remove();
            };

            // Add click handlers for each applicant
            const applicantItems = popup.querySelectorAll('.applicant-photo-item');
            applicantItems.forEach(item => {
                const photoContainer = item.querySelector('.photo-container');
                
                // Hover effect for the entire row
                item.addEventListener('mouseenter', () => {
                    item.style.background = '#f8f9fa';
                });
                item.addEventListener('mouseleave', () => {
                    item.style.background = 'white';
                });
                
                // Click on photo to inject
                photoContainer.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const index = parseInt(item.dataset.index);
                    const applicant = applicants[index];
                    
                    if (applicant.photo) {
                        const success = injectPhoto(applicant);
                        if (success) {
                            showTempMessage(`✅ Photo injected for ${applicant.FirstName}!`, 'success');
                            popup.remove();
                            overlay.remove();
                        } else {
                            showTempMessage('❌ Failed to inject photo. No file input found.', 'error');
                        }
                    } else {
                        showTempMessage(`❌ ${applicant.FirstName} has no photo`, 'error');
                    }
                });
            });

            // Handle Change Photo buttons
            const changePhotoButtons = popup.querySelectorAll('.change-photo-btn');
            changePhotoButtons.forEach(btn => {
                btn.addEventListener('mouseenter', () => {
                    btn.style.background = '#2980b9';
                    btn.style.transform = 'scale(1.05)';
                });
                btn.addEventListener('mouseleave', () => {
                    btn.style.background = '#3498db';
                    btn.style.transform = 'scale(1)';
                });
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const index = parseInt(btn.dataset.index);
                    handleChangePhoto(index, applicants, popup, overlay);
                });
            });
        });
    }

    // NEW FUNCTION: Handle photo change
    function handleChangePhoto(index, applicants, popup, overlay) {
        const applicant = applicants[index];
        
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/jpeg,image/jpg,image/png';
        
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const maxSize = 200 * 1024; // 200KB
            if (file.size > maxSize) {
                showTempMessage(`❌ Photo too large! Max: 200KB, Your file: ${(file.size / 1024).toFixed(2)}KB`, 'error');
                return;
            }
            
            const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
            if (!validTypes.includes(file.type)) {
                showTempMessage('❌ Invalid file type! Use JPEG, JPG, or PNG only.', 'error');
                return;
            }
            
            try {
                const photoData = await readFileAsDataURL(file);
                
                // Update in storage
                chrome.storage.local.get(['bls_applicants'], (result) => {
                    const storedApplicants = result.bls_applicants || [];
                    if (storedApplicants[index]) {
                        storedApplicants[index].photo = photoData;
                        chrome.storage.local.set({ bls_applicants: storedApplicants }, () => {
                            showTempMessage(`✅ Photo updated for ${applicant.FirstName}!`, 'success');
                            
                            // Close and reopen popup to show updated photo
                            popup.remove();
                            overlay.remove();
                            setTimeout(() => createGroupPhotosPopup(), 300);
                        });
                    }
                });
            } catch (error) {
                showTempMessage('❌ Error processing photo', 'error');
                console.error('Photo processing error:', error);
            }
        };
        
        input.click();
    }

    // NEW FUNCTION: Create My Groups Popup - Click group to show applicants
    function createMyGroupsPopup() {
        const existingPopup = document.getElementById("my-groups-popup");
        if (existingPopup) {
            existingPopup.remove();
            return;
        }

        chrome.storage.local.get(['bls_applicants'], (result) => {
            const applicants = result.bls_applicants || [];
            
            if (applicants.length === 0) {
                showTempMessage('❌ No applicants found. Please add applicants in the extension.', 'error');
                return;
            }

            // Group applicants
            const grouped = {};
            applicants.forEach((applicant, index) => {
                const groupName = applicant.group || 'Ungrouped';
                if (!grouped[groupName]) {
                    grouped[groupName] = [];
                }
                grouped[groupName].push({ applicant, index });
            });

            const popup = document.createElement("div");
            popup.id = "my-groups-popup";
            popup.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 90%;
                max-width: 600px;
                max-height: 80vh;
                background: white;
                border: 3px solid #2980b9;
                border-radius: 12px;
                box-shadow: 0 0 30px rgba(0,0,0,0.5);
                z-index: 10001;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            `;

            // Initial view: Show group selector as folder cards (horizontal layout)
            let groupsHTML = '<div style="padding: 20px; display: flex; flex-wrap: wrap; gap: 15px; justify-content: center;">';
            Object.keys(grouped).sort().forEach(groupName => {
                const groupApplicants = grouped[groupName];
                
                groupsHTML += `
                    <div class="group-selector-card" data-group="${groupName}" style="
                        background: linear-gradient(135deg, #f4d03f 0%, #f39c12 100%);
                        padding: 20px;
                        border-radius: 12px;
                        cursor: pointer;
                        transition: all 0.3s ease;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                        min-width: 200px;
                        max-width: 250px;
                        flex: 1;
                    ">
                        <div style="text-align: center;">
                            <div style="font-size: 48px; margin-bottom: 10px;">📁</div>
                            <h4 style="margin: 0 0 8px 0; color: #2c3e50; font-size: 16px; font-weight: 700;">
                                ${groupName}
                            </h4>
                            <div style="font-size: 12px; color: #34495e; font-weight: 600; background: rgba(255,255,255,0.7); padding: 4px 8px; border-radius: 12px; display: inline-block;">
                                ${groupApplicants.length} applicant${groupApplicants.length > 1 ? 's' : ''}
                            </div>
                        </div>
                    </div>
                `;
            });
            groupsHTML += '</div>';

            popup.innerHTML = `
                <div style="background: #2980b9; color: white; padding: 15px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3 style="margin: 0; font-size: 18px;" id="popup-title">👥 Select a Group</h3>
                        <div style="font-size: 12px; opacity: 0.9; margin-top: 3px;" id="popup-subtitle">Click any group to view applicants</div>
                    </div>
                    <button id="close-groups-popup" style="background: none; border: none; color: white; font-size: 24px; cursor: pointer; padding: 0; width: 35px; height: 35px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: background 0.3s;">×</button>
                </div>
                <div id="groups-content" style="flex: 1; overflow-y: auto;">
                    ${groupsHTML}
                </div>
                <div style="padding: 12px; background: #ecf0f1; text-align: center; font-size: 12px; color: #7f8c8d;">
                    Click on any group to view its applicants
                </div>
            `;

            const overlay = document.createElement("div");
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.6);
                z-index: 10000;
            `;

            document.body.appendChild(overlay);
            document.body.appendChild(popup);

            // Close button functionality
            const closeBtn = document.getElementById("close-groups-popup");
            closeBtn.addEventListener('mouseenter', () => {
                closeBtn.style.background = 'rgba(255,255,255,0.2)';
            });
            closeBtn.addEventListener('mouseleave', () => {
                closeBtn.style.background = 'none';
            });
            closeBtn.onclick = overlay.onclick = () => {
                popup.remove();
                overlay.remove();
            };

            // Handle group card click - show applicants
            const groupCards = popup.querySelectorAll('.group-selector-card');
            groupCards.forEach(card => {
                const groupName = card.dataset.group;
                
                card.addEventListener('mouseenter', () => {
                    card.style.background = '#f8f9fa';
                });
                card.addEventListener('mouseleave', () => {
                    card.style.background = 'white';
                });
                
                card.addEventListener('click', () => {
                    showGroupApplicants(popup, groupName, grouped[groupName], applicants);
                });
            });
        });
    }

    // NEW FUNCTION: Show applicants for selected group
    function showGroupApplicants(popup, groupName, groupApplicants, allApplicants) {
        const popupTitle = popup.querySelector('#popup-title');
        const popupSubtitle = popup.querySelector('#popup-subtitle');
        const groupsContent = popup.querySelector('#groups-content');
        
        popupTitle.textContent = `👥 ${groupName}`;
        popupSubtitle.textContent = `${groupApplicants.length} applicant${groupApplicants.length > 1 ? 's' : ''}`;
        
        // Create applicant buttons - VERTICAL LAYOUT (one behind the other)
        let applicantsHTML = `
            <div style="padding: 15px;">
                <button id="back-to-groups" style="
                    background: #95a5a6;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    padding: 8px 12px;
                    font-size: 12px;
                    cursor: pointer;
                    margin-bottom: 15px;
                    transition: all 0.3s;
                    width: 100%;
                ">← Back to Groups</button>
                
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    ${groupApplicants.map(({ applicant, index }) => `
                        <button class="applicant-quick-btn" data-index="${index}" style="
                            background: #34495e;
                            color: white;
                            border: none;
                            border-radius: 8px;
                            padding: 15px;
                            cursor: pointer;
                            font-size: 14px;
                            font-family: system-ui;
                            transition: all 0.3s ease;
                            text-align: left;
                            font-weight: 600;
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            width: 100%;
                        ">
                            <div>
                                <div style="font-size: 15px; margin-bottom: 3px;">
                                    ${applicant.FirstName} ${applicant.LastName}
                                </div>
                                <div style="font-size: 11px; opacity: 0.7;">
                                    ${applicant.PassportNo || 'No passport'}
                                </div>
                            </div>
                            ${applicant.photo ? '<div style="font-size: 20px;">📷</div>' : '<div style="font-size: 20px; opacity: 0.3;">👤</div>'}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
        
        groupsContent.innerHTML = applicantsHTML;
        
        // Back button
        const backBtn = groupsContent.querySelector('#back-to-groups');
        backBtn.addEventListener('mouseenter', () => {
            backBtn.style.background = '#7f8c8d';
        });
        backBtn.addEventListener('mouseleave', () => {
            backBtn.style.background = '#95a5a6';
        });
        backBtn.addEventListener('click', () => {
            popup.remove();
            const overlay = document.querySelector('div[style*="z-index: 10000"]');
            if (overlay) overlay.remove();
            createMyGroupsPopup();
        });
        
        // Handle applicant button clicks
        const applicantButtons = groupsContent.querySelectorAll('.applicant-quick-btn');
        applicantButtons.forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.style.background = '#e67e22';
                btn.style.transform = 'translateY(-3px) scale(1.05)';
                btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = '#34495e';
                btn.style.transform = 'translateY(0) scale(1)';
                btn.style.boxShadow = 'none';
            });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                const applicant = allApplicants[index];
                
                if (applicant) {
                    console.log('📝 Filling form with:', applicant.FirstName);
                    
                    // Fill form
                    const fillSuccess = fillForm(applicant);
                    
                    // Inject photo
                    setTimeout(() => {
                        injectPhoto(applicant);
                    }, 300);
                    
                    if (fillSuccess) {
                        showTempMessage(`✅ Auto-filled ${applicant.FirstName}`, 'success');
                        popup.remove();
                        const overlay = document.querySelector('div[style*="z-index: 10000"]');
                        if (overlay) overlay.remove();
                    } else {
                        showTempMessage('❌ Failed to fill form', 'error');
                    }
                }
            });
        });
    }

    function initializeSlotAutomation() {
        console.log('⏰ Slot automation would run here');
    }

})();