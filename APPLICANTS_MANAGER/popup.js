// Storage keys
const STORAGE_KEY = 'bls_applicants_data'; // New format
const CONFIG_KEY = 'bls_api_config';

// Load applicants from storage
async function loadApplicants() {
    const result = await chrome.storage.local.get([STORAGE_KEY, 'bls_applicants', 'bls_groups']);
    
    let data;
    
    // Try new format first
    if (result[STORAGE_KEY]) {
        data = result[STORAGE_KEY];
    }
    // Fall back to old format
    else if (result.bls_applicants) {
        data = {
            applicants: result.bls_applicants || [],
            groups: result.bls_groups || []
        };
    }
    else {
        data = { applicants: [], groups: [] };
    }
    
    updateUI(data);
    return data;
}

// Update UI
function updateUI(data) {
    const applicants = data.applicants || [];
    const groups = data.groups || [];
    
    // Update count
    document.getElementById('applicant-count').textContent = `${applicants.length} applicant(s) total`;
    
    // Update group filter
    const groupFilter = document.getElementById('group-filter');
    if (groupFilter) {
        const currentValue = groupFilter.value;
        groupFilter.innerHTML = '<option value="">All Groups</option>';
        groups.forEach(group => {
            groupFilter.innerHTML += `<option value="${group}">${group}</option>`;
        });
        groupFilter.value = currentValue;
    }
    
    // Update groups badges
    const groupsContainer = document.getElementById('group-filters');
    if (groupsContainer) {
        if (groups.length === 0) {
            groupsContainer.innerHTML = '<div style="color: #95a5a6; font-size: 10px; text-align: center;">No groups</div>';
        } else {
            const groupCounts = {};
            applicants.forEach(app => {
                const group = app.group || 'No Group';
                groupCounts[group] = (groupCounts[group] || 0) + 1;
            });
            
            groupsContainer.innerHTML = groups.map(group => {
                const count = groupCounts[group] || 0;
                return `<div class="group-badge">${group} (${count})</div>`;
            }).join('');
        }
    }
    
    // Filter by group
    const selectedGroup = groupFilter ? groupFilter.value : '';
    const filtered = selectedGroup 
        ? applicants.filter(app => app.group === selectedGroup)
        : applicants;
    
    // Update applicant list with photos
    const listContainer = document.getElementById('applicant-list');
    if (listContainer) {
        if (filtered.length === 0) {
            listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #95a5a6;">No applicants</div>';
        } else {
            listContainer.innerHTML = filtered.map((app, index) => {
                const actualIndex = applicants.indexOf(app);
                const name = `${app.FirstName || ''} ${app.LastName || ''}`.trim() || 'Unnamed';
                const passport = app.PassportNo || 'No Passport';
                const group = app.group || '';
                
                const photoHtml = app.photo 
                    ? `<img src="${app.photo}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 2px solid #667eea;">` 
                    : '<div style="width: 40px; height: 40px; border-radius: 50%; background: #ecf0f1; display: flex; align-items: center; justify-content: center; font-size: 18px; border: 2px solid #ecf0f1;">👤</div>';
                
                return `
                    <div class="applicant-item" data-index="${actualIndex}" style="
                        display: flex; align-items: center; padding: 12px; cursor: pointer;
                        border-bottom: 1px solid #ecf0f1; transition: all 0.2s; gap: 12px;
                    " onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background='white'">
                        ${photoHtml}
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-weight: 600; font-size: 13px;">${name}</div>
                            <div style="font-size: 11px; color: #7f8c8d;">${passport}</div>
                            ${group ? `<div style="font-size: 10px; color: #667eea;">📁 ${group}</div>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }
    }
}

// Manual sync
async function manualSync() {
    showStatus('🔄 Syncing...', 'info');
    
    try {
        const response = await chrome.runtime.sendMessage({ action: 'syncNow' });
        
        if (response && response.success) {
            await loadApplicants();
            showStatus('✅ Synced!', 'success');
        } else {
            showStatus('❌ Sync failed', 'error');
        }
    } catch (error) {
        showStatus('❌ Error: ' + error.message, 'error');
    }
}

// Pull from API
async function pullFromAPI() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'pullFromAPI' });
        if (response && response.success) {
            await loadApplicants();
        }
    } catch (error) {
        console.error('Pull error:', error);
    }
}

// Export
async function exportData() {
    const data = await loadApplicants();
    const dataStr = JSON.stringify(data, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bls-applicants-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus('✅ Exported!', 'success');
}

// Import
function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            showStatus('📤 Importing...', 'info');
            
            const text = await file.text();
            const importedData = JSON.parse(text);
            
            if (!importedData.applicants || !Array.isArray(importedData.applicants)) {
                throw new Error('Invalid format');
            }
            
            const existing = await loadApplicants();
            const existingPassports = new Set(existing.applicants.map(a => a.PassportNo));
            const newApplicants = importedData.applicants.filter(a => !existingPassports.has(a.PassportNo));
            
            const merged = {
                applicants: [...existing.applicants, ...newApplicants],
                groups: [...new Set([...existing.groups, ...(importedData.groups || [])])]
            };
            
            // Save in BOTH formats
            await chrome.storage.local.set({
                [STORAGE_KEY]: merged,
                'bls_applicants': merged.applicants,
                'bls_groups': merged.groups
            });
            
            await loadApplicants();
            
            // Push to API
            await chrome.runtime.sendMessage({ action: 'pushToAPI' });
            
            showStatus(`✅ Imported ${newApplicants.length} new!`, 'success');
        } catch (error) {
            showStatus('❌ Import failed: ' + error.message, 'error');
        }
    };
    
    input.click();
}

// Show status
function showStatus(message, type = 'success') {
    const statusEl = document.getElementById('status');
    if (!statusEl) return;
    
    statusEl.textContent = message;
    
    if (type === 'success') {
        statusEl.style.background = '#d4edda';
        statusEl.style.color = '#155724';
    } else if (type === 'error') {
        statusEl.style.background = '#f8d7da';
        statusEl.style.color = '#721c24';
    } else if (type === 'info') {
        statusEl.style.background = '#d1ecf1';
        statusEl.style.color = '#0c5460';
    }
    
    if (type !== 'info') {
        setTimeout(() => {
            statusEl.textContent = '✅ Ready';
            statusEl.style.background = '#ecf0f1';
            statusEl.style.color = '#2c3e50';
        }, 3000);
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadApplicants();
    
    document.getElementById('download-applicants')?.addEventListener('click', exportData);
    document.getElementById('upload-applicants')?.addEventListener('click', importData);
    document.getElementById('sync-button')?.addEventListener('click', manualSync);
    document.getElementById('group-filter')?.addEventListener('change', loadApplicants);
    
    // Applicant selection
    document.getElementById('applicant-list')?.addEventListener('click', (e) => {
        const item = e.target.closest('.applicant-item');
        if (item) {
            document.querySelectorAll('.applicant-item').forEach(i => {
                i.style.background = 'white';
                i.style.borderLeft = 'none';
            });
            item.style.background = '#e7f3ff';
            item.style.borderLeft = '4px solid #667eea';
        }
    });
    
    // Auto-refresh
    setInterval(loadApplicants, 5000);
    
    // Initial pull
    setTimeout(pullFromAPI, 500);
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes[STORAGE_KEY] || changes['bls_applicants'])) {
        loadApplicants();
    }
});