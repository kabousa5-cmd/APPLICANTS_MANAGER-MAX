// BLS Applicant Manager - Background Service Worker
// Fixed to work with BOTH old and new storage formats

const API_URL = 'https://bls-sync-api-production.up.railway.app';
const STORAGE_KEY = 'bls_applicants_data'; // New format
const CONFIG_KEY = 'bls_api_config';
const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes ⏰

let apiConfig = {
    apiUrl: API_URL,
    syncEnabled: true,
    lastSync: null
};

let lastApplicantCount = 0; // Track count to detect new applicants
let lastForceSyncTimestamp = 0; // Track force sync from dashboard
let forceSyncInterval = null; // Polling interval for force sync
let isPullingFromAPI = false; // Flag to prevent push during pull

console.log('🚀 BLS Background Service Worker starting...');
console.log('⏰ Auto-sync enabled: Every 5 minutes');

// Initialize
chrome.runtime.onInstalled.addListener(async () => {
    console.log('📦 Extension installed/updated');
    
    const config = await chrome.storage.local.get(CONFIG_KEY);
    if (config[CONFIG_KEY]) {
        apiConfig = config[CONFIG_KEY];
    }
    
    // Load current applicant count
    const stored = await getStoredApplicants();
    lastApplicantCount = stored.length;
    console.log('📊 Initial applicant count:', lastApplicantCount);
    
    await pullFromAPI();
    startAutoSync();
    startForceSyncPolling(); // Start polling for dashboard force sync
    
    console.log('✅ Initialization complete');
    console.log('⏰ Auto-sync: Every 5 minutes with chrome.alarms');
    console.log('🔔 Force sync: Polling every 2 seconds');
});

// Handle browser startup (recreate alarm after browser restarts)
chrome.runtime.onStartup.addListener(() => {
    console.log('🔄 Browser started, recreating alarm...');
    startAutoSync();
    startForceSyncPolling();
});

// Start auto-sync timer using chrome.alarms (persists when service worker sleeps!)
function startAutoSync() {
    console.log('⏰ Starting auto-sync with chrome.alarms...');
    console.log('📊 Sync interval: Every 5 minutes');
    
    // Create alarm that repeats every 5 minutes
    chrome.alarms.create('auto-sync', {
        delayInMinutes: 5,
        periodInMinutes: 5
    });
    
    console.log('✅ Alarm created! Will sync every 5 minutes even when service worker sleeps');
    console.log('🔄 Next sync in 5 minutes');
}

// Start polling for force sync commands from dashboard
function startForceSyncPolling() {
    console.log('🔔 Starting force sync polling (every 2 seconds)');
    
    // Check every 2 seconds for force sync command
    forceSyncInterval = setInterval(async () => {
        try {
            const response = await fetch(`${apiConfig.apiUrl}/api/applicants`);
            if (response.ok) {
                const data = await response.json();
                
                // Check if there's a new force sync command
                if (data.forceSyncTimestamp && data.forceSyncTimestamp > lastForceSyncTimestamp) {
                    const commandAge = Date.now() - data.forceSyncTimestamp;
                    
                    // Only process if command is fresh (within last 30 seconds)
                    if (commandAge < 30000) {
                        console.log('');
                        console.log('🔔🔔🔔 FORCE SYNC COMMAND FROM DASHBOARD! 🔔🔔🔔');
                        console.log(`   Command timestamp: ${new Date(data.forceSyncTimestamp).toLocaleTimeString()}`);
                        console.log(`   Command age: ${commandAge}ms`);
                        console.log('');
                        
                        lastForceSyncTimestamp = data.forceSyncTimestamp;
                        
                        // Show blue badge
                        showBadge('🔔', '#3498db', 3000);
                        
                        // Trigger sync immediately
                        await pullFromAPI();
                        
                        console.log('✅ Force sync completed!');
                        console.log('');
                    }
                }
            }
        } catch (e) {
            // Silent fail - don't spam console
        }
    }, 2000); // Check every 2 seconds
    
    console.log('✅ Force sync polling started');
}

// Listen for alarm
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'auto-sync') {
        const now = new Date().toLocaleTimeString();
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`🔔 ALARM TRIGGERED at ${now}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        pullFromAPI();
        console.log('✅ Auto-sync complete');
        console.log('⏰ Next alarm in 5 minutes');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
    }
});

// Listen for storage changes
chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === 'local' && (changes[STORAGE_KEY] || changes['bls_applicants'])) {
        // Don't push if we're currently pulling from API
        if (isPullingFromAPI) {
            console.log('⏭️ Skipping push (currently pulling from API)');
            return;
        }
        
        console.log('📝 Local data changed, pushing to API...');
        await pushToAPI();
    }
});

// Pull data from API
async function pullFromAPI() {
    if (!apiConfig.syncEnabled) {
        console.log('⏸️ Sync disabled');
        return;
    }

    try {
        isPullingFromAPI = true; // Set flag to prevent push
        console.log('⬇️ Pulling from API...');
        
        const response = await fetch(`${apiConfig.apiUrl}/api/applicants`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        console.log('📡 Response status:', response.status);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const newApplicantCount = data.applicants?.length || 0;
        console.log('📊 Received:', newApplicantCount, 'applicants');
        
        // 🔔 DETECT NEW APPLICANTS!
        if (lastApplicantCount > 0 && newApplicantCount > lastApplicantCount) {
            const newCount = newApplicantCount - lastApplicantCount;
            console.log('');
            console.log('🎉🎉🎉 NEW APPLICANTS DETECTED! 🎉🎉🎉');
            console.log(`📈 ${newCount} new applicant(s) added!`);
            console.log(`   Previous: ${lastApplicantCount}`);
            console.log(`   Current: ${newApplicantCount}`);
            console.log('');
            
            // Show badge with count of new applicants
            showBadge(`+${newCount}`, '#27ae60', 5000); // Green badge for 5 seconds
            
            // Get the new applicants' names
            const oldApplicants = await getStoredApplicants();
            const oldPassports = new Set(oldApplicants.map(a => a.PassportNo));
            const newApplicants = data.applicants.filter(a => !oldPassports.has(a.PassportNo));
            
            if (newApplicants.length > 0) {
                console.log('📋 New applicants:');
                newApplicants.forEach((app, i) => {
                    const name = `${app.FirstName || ''} ${app.LastName || ''}`.trim() || 'Unnamed';
                    console.log(`   ${i + 1}. ${name} (${app.PassportNo})`);
                });
            }
        } else if (lastApplicantCount > 0 && newApplicantCount < lastApplicantCount) {
            const removedCount = lastApplicantCount - newApplicantCount;
            console.log(`⚠️ ${removedCount} applicant(s) removed`);
        } else if (newApplicantCount === lastApplicantCount) {
            console.log('➡️ No changes in applicant count');
        }
        
        // Update last count
        lastApplicantCount = newApplicantCount;
        
        // Save in BOTH formats for compatibility
        await chrome.storage.local.set({
            // New format (for popup/sync)
            [STORAGE_KEY]: {
                applicants: data.applicants || [],
                groups: data.groups || []
            },
            // Old format (for content.js)
            'bls_applicants': data.applicants || [],
            'bls_groups': data.groups || []
        });

        apiConfig.lastSync = new Date().toISOString();
        await chrome.storage.local.set({ [CONFIG_KEY]: apiConfig });

        console.log('✅ Pull successful! Saved in both formats');
        showBadge('✓', '#27ae60');

    } catch (error) {
        console.error('❌ Pull failed:', error.message);
        showBadge('✗', '#e74c3c');
    } finally {
        isPullingFromAPI = false; // Clear flag
    }
}

// Push data to API
async function pushToAPI() {
    if (!apiConfig.syncEnabled) {
        console.log('⏸️ Sync disabled');
        return;
    }

    try {
        console.log('⬆️ Pushing to API...');
        
        // Try to get data from either format
        const result = await chrome.storage.local.get([STORAGE_KEY, 'bls_applicants', 'bls_groups']);
        
        let applicants, groups;
        
        // Check new format first
        if (result[STORAGE_KEY]) {
            applicants = result[STORAGE_KEY].applicants || [];
            groups = result[STORAGE_KEY].groups || [];
        } 
        // Fall back to old format
        else {
            applicants = result.bls_applicants || [];
            groups = result.bls_groups || [];
        }

        console.log('📤 Pushing:', applicants.length, 'applicants');

        const response = await fetch(`${apiConfig.apiUrl}/api/applicants/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                applicants: applicants,
                groups: groups
            })
        });

        console.log('📡 Response status:', response.status);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const resultData = await response.json();
        console.log('📊 Synced:', resultData.data?.applicants?.length || 0, 'applicants');
        
        // Set flag to prevent re-triggering push when we save the response
        isPullingFromAPI = true;
        
        // Save in BOTH formats
        await chrome.storage.local.set({
            [STORAGE_KEY]: {
                applicants: resultData.data.applicants || [],
                groups: resultData.data.groups || []
            },
            'bls_applicants': resultData.data.applicants || [],
            'bls_groups': resultData.data.groups || []
        });
        
        isPullingFromAPI = false; // Clear flag

        apiConfig.lastSync = new Date().toISOString();
        await chrome.storage.local.set({ [CONFIG_KEY]: apiConfig });

        console.log('✅ Push successful!');
        showBadge('✓', '#27ae60');

    } catch (error) {
        console.error('❌ Push failed:', error.message);
        showBadge('✗', '#e74c3c');
    }
}

// Show badge
function showBadge(text, color, duration = 2000) {
    try {
        chrome.action.setBadgeBackgroundColor({ color });
        chrome.action.setBadgeText({ text });
        setTimeout(() => {
            chrome.action.setBadgeText({ text: '' });
        }, duration);
    } catch (e) {
        // Ignore
    }
}

// Helper: Get stored applicants
async function getStoredApplicants() {
    const result = await chrome.storage.local.get([STORAGE_KEY, 'bls_applicants']);
    if (result[STORAGE_KEY]) {
        return result[STORAGE_KEY].applicants || [];
    }
    return result.bls_applicants || [];
}

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('📨 Message:', request.action);
    
    if (request.action === 'syncNow' || request.action === 'forceSyncNow') {
        (async () => {
            console.log('🔄 Manual/Force sync triggered');
            await pullFromAPI();
            sendResponse({ success: true });
        })();
        return true;
    }
    
    if (request.action === 'pullFromAPI') {
        pullFromAPI().then(() => {
            sendResponse({ success: true });
        }).catch(error => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }
    
    if (request.action === 'pushToAPI') {
        pushToAPI().then(() => {
            sendResponse({ success: true });
        }).catch(error => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }
});

console.log('✅ Background Service Worker loaded!');