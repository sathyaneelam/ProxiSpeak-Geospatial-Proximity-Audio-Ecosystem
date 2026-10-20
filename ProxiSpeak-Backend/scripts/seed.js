const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../src/config/database');
const { seedDefaultOffice, DEFAULT_ROOM_ZONES, DEFAULT_OBSTACLES } = require('../src/services/officeService');
const User = require('../src/models/User');
const LivePosition = require('../src/models/LivePosition');
const Office = require('../src/models/Office');

/**
 * Generate 60 deterministic test users positioned across office-01
 * Canvas dimensions: 1000 x 600
 */
function generate60TestUsers(officeId = 'office-01') {
  const avatarColors = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'
  ];

  // Distribute 60 avatars across office zones and open corridors
  // Workstation A (15 avatars), Workstation B (15 avatars),
  // Meeting Area (12 avatars), Lounge (12 avatars), Hallway (6 avatars)
  const users = [];

  for (let i = 1; i <= 60; i++) {
    const pad = String(i).padStart(2, '0');
    let x, y;

    if (i <= 15) {
      // Workstation A: x: [55, 290], y: [55, 230]
      const col = (i - 1) % 5;
      const row = Math.floor((i - 1) / 5);
      x = 60 + col * 50;
      y = 65 + row * 60;
    } else if (i <= 30) {
      // Workstation B: x: [700, 940], y: [55, 230]
      const col = (i - 16) % 5;
      const row = Math.floor((i - 16) / 5);
      x = 705 + col * 50;
      y = 65 + row * 60;
    } else if (i <= 42) {
      // Meeting Area: x: [60, 320], y: [365, 535]
      const col = (i - 31) % 4;
      const row = Math.floor((i - 31) / 4);
      x = 75 + col * 70;
      y = 380 + row * 60;
    } else if (i <= 54) {
      // Lounge: x: [670, 930], y: [365, 535]
      const col = (i - 43) % 4;
      const row = Math.floor((i - 43) / 4);
      x = 680 + col * 70;
      y = 380 + row * 60;
    } else {
      // Central hallway / corridor: x: [380, 620], y: [150, 450]
      const idx = i - 55;
      x = 420 + (idx % 2) * 120;
      y = 180 + Math.floor(idx / 2) * 100;
    }

    users.push({
      _id: new mongoose.Types.ObjectId(),
      userId: `test_user_${pad}`,
      displayName: `Test Avatar ${pad}`,
      email: `testuser${pad}@proxispeak.local`,
      avatarColor: avatarColors[(i - 1) % avatarColors.length],
      avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=user${pad}`,
      isOnline: true,
      officeId,
      location: [x, y],
      lastUpdated: new Date()
    });
  }

  return users;
}

/**
 * Safely upsert test users and their live positions without duplication.
 * Reuses existing test user records matching their unique email and updates their live positions.
 *
 * @param {Array} testUsers - Generated test user definitions
 * @param {string|mongoose.Types.ObjectId} officeId - Target office ObjectId
 * @returns {Promise<{ users: Array, positions: Array }>} Upserted documents
 */
async function upsertTestUsersAndPositions(testUsers, officeId) {
  const operations = testUsers.map(async (u) => {
    // 1. Re-use existing user or create a new one using atomic upsert by unique email
    const userDoc = await User.findOneAndUpdate(
      { email: u.email },
      {
        $set: {
          displayName: u.displayName,
          avatarColor: u.avatarColor,
          avatarUrl: u.avatarUrl,
          isOnline: true,
          currentOfficeId: officeId,
          lastActive: new Date()
        },
        $setOnInsert: {
          _id: u._id
        }
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true
      }
    );

    // 2. Re-use existing live position or create one using atomic upsert by unique userId
    const positionDoc = await LivePosition.findOneAndUpdate(
      { userId: userDoc._id },
      {
        $set: {
          officeId,
          location: u.location,
          lastUpdated: new Date()
        }
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true
      }
    );

    return { user: userDoc, position: positionDoc };
  });

  const results = await Promise.all(operations);
  return {
    users: results.map((r) => r.user),
    positions: results.map((r) => r.position)
  };
}

/**
 * Seed database with default office and 60 test users.
 * Safely upserts records to avoid duplicates and preserve IDs on repeated runs.
 *
 * @param {object} [options]
 * @param {boolean} [options.disconnectOnExit] - Whether to disconnect after seeding
 * @returns {Promise<{ office: object, testUsers: Array }>}
 */
async function seedDatabase(options = {}) {
  const { disconnectOnExit } = options;
  console.log('--- Starting ProxiSpeak Office & User Seeding ---');

  const initiallyConnected = mongoose.connection.readyState === 1;
  let isConnected = initiallyConnected;

  if (!isConnected) {
    try {
      await connectDB(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 2500,
        exitOnError: false
      });
      isConnected = true;
    } catch (err) {
      console.warn('MongoDB connection not available:', err.message);
      console.log('Generating seed data in memory for validation...');
    }
  }

  const office = isConnected
    ? await seedDefaultOffice()
    : {
        _id: new mongoose.Types.ObjectId(),
        code: 'office-01',
        name: 'ProxiSpeak Main Office',
        dimensions: { width: 1000, height: 600 },
        proximityRadius: 100,
        zones: DEFAULT_ROOM_ZONES,
        obstacles: DEFAULT_OBSTACLES
      };

  console.log(`[OK] Default Office (${office.code}) seeded with:`);
  console.log(`     - Dimensions: ${office.dimensions.width}x${office.dimensions.height}px`);
  console.log(`     - Audio Proximity Radius: ${office.proximityRadius}px`);
  console.log(`     - Room Zones: ${office.zones.length}`);
  console.log(`     - Furniture Obstacles: ${office.obstacles.length}`);

  const testUsers = generate60TestUsers(office._id || 'office-01');

  if (isConnected) {
    const { users, positions } = await upsertTestUsersAndPositions(testUsers, office._id);

    // Sync testUsers array with persisted user IDs to maintain consistent references
    testUsers.forEach((u, i) => {
      if (users[i]) {
        u._id = users[i]._id;
      }
    });

    console.log(`[OK] Successfully persisted/updated ${users.length} test users and live positions in office '${office.code}' in MongoDB.`);

    const shouldDisconnect = disconnectOnExit !== undefined
      ? disconnectOnExit
      : (require.main === module || !initiallyConnected);

    if (shouldDisconnect) {
      await disconnectDB();
    }
  } else {
    console.log(`[OK] Generated 60 test users (ready to persist once MongoDB is online).`);
  }

  return { office, testUsers };
}

if (require.main === module) {
  require('dotenv').config();
  seedDatabase({ disconnectOnExit: true })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seeding failed:', err);
      process.exit(1);
    });
}

module.exports = {
  generate60TestUsers,
  seedDatabase,
  upsertTestUsersAndPositions
};
