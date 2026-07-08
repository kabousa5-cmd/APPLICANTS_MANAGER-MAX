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

  // Build map of current server applicants
  const serverMap = new Map(sharedData.applicants.map(a => [a.PassportNo, a]));

  for (const incoming of applicants) {
    if (!incoming.PassportNo) continue; // skip entries with no passport key

    const existing = serverMap.get(incoming.PassportNo);

    if (!existing) {
      // New applicant — always add
      serverMap.set(incoming.PassportNo, {
        ...incoming,
        _updatedAt: incoming._updatedAt || Date.now()
      });
    } else {
      // Both sides have this passport: keep the more recently updated one
      const existingTime = existing._updatedAt  || 0;
      const incomingTime = incoming._updatedAt  || 0;
      if (incomingTime >= existingTime) {
        serverMap.set(incoming.PassportNo, {
          ...incoming,
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

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BLS Server on port ${PORT}`);
  console.log('🔀 Sync mode: MERGE by PassportNo (no more overwrites)');
  console.log('🗑️  Atomic deletes: single applicant + group endpoints');
  console.log('🔔 Force sync: POST /api/force-sync to push to all extensions');
  console.log('🔄 Dashboard: auto-refreshes every 10 seconds');
});
