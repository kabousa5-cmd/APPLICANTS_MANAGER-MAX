const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// FIX: Added forceSyncTimestamp so extensions can detect when to re-pull
let sharedData = {
  applicants: [],
  groups: [],
  lastModified: new Date().toISOString(),
  forceSyncTimestamp: 0
};

// ===== Profiles store (formerly Firebase Realtime DB) =====
// Used by the Tampermonkey userscript. Keyed by a generated id, same shape
// the script previously got from Firebase: { id1: {...}, id2: {...} }
let profilesData = {};

function generateProfileId() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

let currentCommand = {
  location: '',
  visaType: '',
  timestamp: Date.now()
};

app.use(express.static(path.join(__dirname, 'public')));


app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', applicants: sharedData.applicants.length, groups: sharedData.groups.length });
});

// Returns full shared data including forceSyncTimestamp (used by extensions)
app.get('/api/applicants', (req, res) => {
  res.json(sharedData);
});

// FIX: MERGE instead of overwrite - the root cause fix
// Incoming applicants are upserted by PassportNo.
// Applicants already on server but NOT in payload are KEPT (not deleted).
// Conflict resolution: _updatedAt timestamp decides winner.
app.post('/api/applicants/sync', (req, res) => {
  const { applicants, groups } = req.body;
  if (!Array.isArray(applicants)) return res.status(400).json({ error: 'Invalid: applicants must be an array' });

  // FIX: normalize the key (trim whitespace) so a passport number that picked up
  // stray spaces from autofill/scraping doesn't get treated as a different record
  const normKey = (p) => (p || '').trim();

  // Build map of current server applicants
  const serverMap = new Map(sharedData.applicants.map(a => [normKey(a.PassportNo), a]));

  for (const incoming of applicants) {
    const key = normKey(incoming.PassportNo);
    if (!key) continue; // skip entries with no passport key

    const existing = serverMap.get(key);

    if (!existing) {
      // New applicant — always add
      serverMap.set(key, {
        ...incoming,
        PassportNo: key,
        _updatedAt: incoming._updatedAt || Date.now()
      });
    } else {
      // Both sides have this passport: keep the more recently updated one
      const existingTime = existing._updatedAt  || 0;
      const incomingTime = incoming._updatedAt  || 0;
      if (incomingTime >= existingTime) {
        serverMap.set(key, {
          ...incoming,
          PassportNo: key,
          _updatedAt: incomingTime || Date.now()
        });
      }
      // else: server version is newer — keep it, discard incoming
    }
  }

  sharedData.applicants = Array.from(serverMap.values());

  // Merge groups (union — never remove a group because a stale client didn't have it)
  const allGroups = new Set([...sharedData.groups, ...(groups || [])]);
  sharedData.groups = Array.from(allGroups);
  sharedData.lastModified = new Date().toISOString();

  res.json({
    success: true,
    data: sharedData,
    stats: { totalApplicants: sharedData.applicants.length, totalGroups: sharedData.groups.length }
  });
});

// FIX: Atomic edit — updates the ONE record matching the original passport number.
// Unlike /api/applicants/sync (a full-list merge), this can never create a duplicate,
// even if the passport number field itself is being changed as part of the edit,
// and even if another client's stale full-list sync races with it.
app.put('/api/applicants/:passportNo', (req, res) => {
  const originalPassportNo = decodeURIComponent(req.params.passportNo).trim();
  const updated = req.body;

  if (!updated || !updated.PassportNo || !updated.PassportNo.trim()) {
    return res.status(400).json({ error: 'PassportNo is required in the request body' });
  }

  const newPassportNo = updated.PassportNo.trim();

  // Block silently merging into a different existing applicant if the new
  // passport number collides with someone else's record
  const clash = sharedData.applicants.find(
    a => a.PassportNo === newPassportNo && a.PassportNo !== originalPassportNo
  );
  if (clash) {
    return res.status(409).json({ error: `Passport ${newPassportNo} is already used by another applicant` });
  }

  const idx = sharedData.applicants.findIndex(a => a.PassportNo === originalPassportNo);
  const record = { ...updated, PassportNo: newPassportNo, _updatedAt: Date.now() };

  if (idx >= 0) {
    sharedData.applicants[idx] = record; // update the exact record in place
  } else {
    sharedData.applicants.push(record); // original wasn't found — add it rather than lose the edit
  }

  if (record.group && !sharedData.groups.includes(record.group)) {
    sharedData.groups.push(record.group);
  }
  sharedData.lastModified = new Date().toISOString();

  res.json({ success: true, data: sharedData });
});

// FIX: Atomic group delete — safe, doesn't require client to send full applicant list
app.delete('/api/applicants/group/:groupName', (req, res) => {
  const groupName = decodeURIComponent(req.params.groupName);
  sharedData.applicants = sharedData.applicants.filter(a => a.group !== groupName);
  sharedData.groups     = sharedData.groups.filter(g => g !== groupName);
  sharedData.lastModified = new Date().toISOString();
  res.json({ success: true, data: sharedData });
});

// FIX: Atomic single-applicant delete by passport number
app.delete('/api/applicants/:passportNo', (req, res) => {
  const passportNo = decodeURIComponent(req.params.passportNo);
  sharedData.applicants = sharedData.applicants.filter(a => a.PassportNo !== passportNo);
  sharedData.lastModified = new Date().toISOString();
  res.json({ success: true, data: sharedData });
});

// Delete ALL applicants
app.delete('/api/applicants', (req, res) => {
  sharedData = {
    applicants: [],
    groups: [],
    lastModified: new Date().toISOString(),
    forceSyncTimestamp: sharedData.forceSyncTimestamp // preserve so extensions don't re-trigger
  };
  res.json({ success: true });
});

// FIX: Force sync endpoint — sets forceSyncTimestamp so polling extensions re-pull
app.post('/api/force-sync', (req, res) => {
  sharedData.forceSyncTimestamp = Date.now();
  console.log('📢 Force sync triggered at', new Date().toISOString());
  res.json({ success: true, timestamp: sharedData.forceSyncTimestamp });
});

app.post('/api/broadcast', (req, res) => {
  const { location, visaType, timestamp } = req.body;
  if (!location || !visaType) {
    return res.status(400).json({ success: false, error: 'Missing location or visaType' });
  }
  currentCommand = { location, visaType, timestamp: timestamp || Date.now() };
  console.log('📢 Broadcast:', currentCommand);
  res.json({ success: true, command: currentCommand });
});

app.get('/api/broadcast', (req, res) => {
  res.json({ success: true, ...currentCommand });
});

// ===== Profiles endpoints (replaces Firebase for the Tampermonkey userscript) =====

// GET all profiles -> { id: {...}, id: {...} } (empty object if none)
app.get('/api/profiles', (req, res) => {
  res.json(profilesData);
});

// POST a new profile -> server generates the id (like Firebase push)
app.post('/api/profiles', (req, res) => {
  const id = generateProfileId();
  profilesData[id] = { ...req.body };
  res.json({ success: true, id, name: id });
});

// PUT (create-or-replace) a profile at a specific id
app.put('/api/profiles/:id', (req, res) => {
  const { id } = req.params;
  profilesData[id] = { ...req.body };
  res.json({ success: true, id });
});

// DELETE a single profile
app.delete('/api/profiles/:id', (req, res) => {
  const { id } = req.params;
  delete profilesData[id];
  res.json({ success: true, id });
});

// DELETE all profiles
app.delete('/api/profiles', (req, res) => {
  profilesData = {};
  res.json({ success: true });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BLS Server on port ${PORT}`);
  console.log('🔀 Sync mode: MERGE by PassportNo (no more overwrites)');
  console.log('🗑️  Atomic deletes: single applicant + group endpoints');
  console.log('🔔 Force sync: POST /api/force-sync to push to all extensions');
  console.log('🔄 Dashboard: auto-refreshes every 10 seconds');
  console.log('📇 Profiles API: /api/profiles (Firebase replacement for the userscript)');
});
