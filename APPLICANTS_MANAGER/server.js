const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// In-memory storage (you can replace with MongoDB/PostgreSQL)
const users = new Map();
const applicantData = new Map();

// Generate API key
function generateApiKey() {
  return crypto.randomBytes(32).toString('hex');
}

// Middleware to verify API key
function verifyApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  
  const user = Array.from(users.values()).find(u => u.apiKey === apiKey);
  if (!user) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  req.userId = user.id;
  next();
}

// Routes

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'BLS Applicant Manager Sync API',
    version: '1.0.0'
  });
});

// Register/Login - Get or create API key
app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  // Hash password (in production, use bcrypt)
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  
  // Check if user exists
  let user = Array.from(users.values()).find(u => u.email === email);
  
  if (user) {
    // Verify password
    if (user.passwordHash !== passwordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
  } else {
    // Create new user
    const userId = crypto.randomUUID();
    const apiKey = generateApiKey();
    
    user = {
      id: userId,
      email,
      passwordHash,
      apiKey,
      createdAt: new Date().toISOString()
    };
    
    users.set(userId, user);
  }
  
  res.json({
    apiKey: user.apiKey,
    userId: user.id,
    email: user.email
  });
});

// Get all applicants
app.get('/api/applicants', verifyApiKey, (req, res) => {
  const data = applicantData.get(req.userId) || { applicants: [], groups: [] };
  res.json(data);
});

// Sync applicants (merge strategy)
app.post('/api/applicants/sync', verifyApiKey, (req, res) => {
  const { applicants, groups, lastSyncTimestamp } = req.body;
  
  if (!Array.isArray(applicants)) {
    return res.status(400).json({ error: 'Applicants must be an array' });
  }
  
  // Get existing data
  const existingData = applicantData.get(req.userId) || { 
    applicants: [], 
    groups: [],
    lastModified: new Date().toISOString()
  };
  
  // Merge applicants (keep latest version based on passport number)
  const mergedApplicants = new Map();
  
  // Add existing applicants
  existingData.applicants.forEach(app => {
    mergedApplicants.set(app.passport, app);
  });
  
  // Merge with incoming applicants
  applicants.forEach(app => {
    if (app.passport) {
      mergedApplicants.set(app.passport, app);
    }
  });
  
  // Merge groups
  const mergedGroups = Array.from(new Set([
    ...(existingData.groups || []),
    ...(groups || [])
  ]));
  
  const updatedData = {
    applicants: Array.from(mergedApplicants.values()),
    groups: mergedGroups,
    lastModified: new Date().toISOString()
  };
  
  applicantData.set(req.userId, updatedData);
  
  res.json({
    success: true,
    data: updatedData,
    stats: {
      totalApplicants: updatedData.applicants.length,
      totalGroups: updatedData.groups.length
    }
  });
});

// Replace all applicants (full sync)
app.put('/api/applicants', verifyApiKey, (req, res) => {
  const { applicants, groups } = req.body;
  
  if (!Array.isArray(applicants)) {
    return res.status(400).json({ error: 'Applicants must be an array' });
  }
  
  const data = {
    applicants,
    groups: groups || [],
    lastModified: new Date().toISOString()
  };
  
  applicantData.set(req.userId, data);
  
  res.json({
    success: true,
    data,
    stats: {
      totalApplicants: data.applicants.length,
      totalGroups: data.groups.length
    }
  });
});

// Delete all applicants
app.delete('/api/applicants', verifyApiKey, (req, res) => {
  applicantData.delete(req.userId);
  
  res.json({
    success: true,
    message: 'All applicants deleted'
  });
});

// Get sync status
app.get('/api/sync/status', verifyApiKey, (req, res) => {
  const data = applicantData.get(req.userId);
  
  res.json({
    hasSyncedData: !!data,
    lastModified: data?.lastModified || null,
    applicantCount: data?.applicants?.length || 0,
    groupCount: data?.groups?.length || 0
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 BLS Sync API running on port ${PORT}`);
});
