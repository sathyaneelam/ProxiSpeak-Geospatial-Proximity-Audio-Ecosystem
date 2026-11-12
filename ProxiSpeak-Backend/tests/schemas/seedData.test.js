const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const User = require('../../src/models/User');
const LivePosition = require('../../src/models/LivePosition');
const {
  generate60TestUsers,
  upsertTestUsersAndPositions,
  seedDatabase
} = require('../../scripts/seed');

describe('Seed Data Quality & Repeatable Seeding Validation', () => {
  const dummyOfficeId = new mongoose.Types.ObjectId();

  describe('Benchmark Dataset Quality & Schema Constraints', () => {
    it('should generate exactly 60 test users with unique emails and valid user fields', async () => {
      const testUsers = generate60TestUsers(dummyOfficeId);
      assert.strictEqual(testUsers.length, 60, 'Dataset must contain exactly 60 test users');

      const emails = new Set();
      for (const u of testUsers) {
        assert.ok(u.email, 'Email must be present');
        assert.match(u.email, /^testuser\d{2}@proxispeak\.local$/, 'Email must follow testuserXX pattern');
        assert.strictEqual(emails.has(u.email), false, `Duplicate email detected: ${u.email}`);
        emails.add(u.email);

        // Validate directly against Mongoose User schema
        const userDoc = new User({
          displayName: u.displayName,
          email: u.email,
          avatarColor: u.avatarColor,
          avatarUrl: u.avatarUrl,
          isOnline: u.isOnline,
          currentOfficeId: dummyOfficeId
        });
        await userDoc.validate();
      }

      assert.strictEqual(emails.size, 60, 'All 60 test users must have unique emails');
    });

    it('should satisfy LivePosition schema planar coordinate validation for all 60 users', async () => {
      const testUsers = generate60TestUsers(dummyOfficeId);

      for (const u of testUsers) {
        assert.ok(Array.isArray(u.location), 'Location must be an array');
        assert.strictEqual(u.location.length, 2, 'Location must be a 2-element array [x, y]');
        assert.ok(typeof u.location[0] === 'number' && !isNaN(u.location[0]) && isFinite(u.location[0]));
        assert.ok(typeof u.location[1] === 'number' && !isNaN(u.location[1]) && isFinite(u.location[1]));
        assert.ok(u.location[0] >= 0, 'X coordinate must be non-negative');
        assert.ok(u.location[1] >= 0, 'Y coordinate must be non-negative');

        // Validate directly against Mongoose LivePosition schema
        const posDoc = new LivePosition({
          userId: u._id,
          officeId: dummyOfficeId,
          location: u.location
        });
        await posDoc.validate();
      }
    });

    it('should position all 60 users strictly within 1000x600 canvas and designated room zones', () => {
      const testUsers = generate60TestUsers(dummyOfficeId);

      let workstationACount = 0;
      let workstationBCount = 0;
      let meetingAreaCount = 0;
      let loungeCount = 0;
      let hallwayCount = 0;

      for (let i = 0; i < testUsers.length; i++) {
        const [x, y] = testUsers[i].location;

        // Bounded by 1000 x 600 canvas
        assert.ok(x >= 0 && x <= 1000, `User ${i + 1} x coordinate ${x} outside canvas [0, 1000]`);
        assert.ok(y >= 0 && y <= 600, `User ${i + 1} y coordinate ${y} outside canvas [0, 600]`);

        if (i < 15) {
          // Workstation A (x: [60, 260], y: [65, 185])
          assert.ok(x >= 60 && x <= 260, `Workstation A avatar ${i + 1} x=${x} out of range`);
          assert.ok(y >= 65 && y <= 185, `Workstation A avatar ${i + 1} y=${y} out of range`);
          workstationACount++;
        } else if (i < 30) {
          // Workstation B (x: [705, 905], y: [65, 185])
          assert.ok(x >= 705 && x <= 905, `Workstation B avatar ${i + 1} x=${x} out of range`);
          assert.ok(y >= 65 && y <= 185, `Workstation B avatar ${i + 1} y=${y} out of range`);
          workstationBCount++;
        } else if (i < 42) {
          // Meeting Area (x: [75, 285], y: [380, 500])
          assert.ok(x >= 75 && x <= 285, `Meeting Area avatar ${i + 1} x=${x} out of range`);
          assert.ok(y >= 380 && y <= 500, `Meeting Area avatar ${i + 1} y=${y} out of range`);
          meetingAreaCount++;
        } else if (i < 54) {
          // Lounge (x: [680, 890], y: [380, 500])
          assert.ok(x >= 680 && x <= 890, `Lounge avatar ${i + 1} x=${x} out of range`);
          assert.ok(y >= 380 && y <= 500, `Lounge avatar ${i + 1} y=${y} out of range`);
          loungeCount++;
        } else {
          // Central Hallway (x: [420, 540], y: [180, 380])
          assert.ok(x >= 420 && x <= 540, `Hallway avatar ${i + 1} x=${x} out of range`);
          assert.ok(y >= 180 && y <= 380, `Hallway avatar ${i + 1} y=${y} out of range`);
          hallwayCount++;
        }
      }

      assert.strictEqual(workstationACount, 15, 'Workstation A must have 15 avatars');
      assert.strictEqual(workstationBCount, 15, 'Workstation B must have 15 avatars');
      assert.strictEqual(meetingAreaCount, 12, 'Meeting Area must have 12 avatars');
      assert.strictEqual(loungeCount, 12, 'Lounge must have 12 avatars');
      assert.strictEqual(hallwayCount, 6, 'Hallway must have 6 avatars');
      assert.strictEqual(
        workstationACount + workstationBCount + meetingAreaCount + loungeCount + hallwayCount,
        60
      );
    });
  });

  describe('Safe & Repeatable Seeding Idempotency', () => {
    it('should upsert test records without creating duplicates and preserve user IDs on repeated runs', async () => {
      const mockUserStore = new Map();
      const mockPositionStore = new Map();

      // Mock Mongoose findOneAndUpdate on User and LivePosition to simulate atomic MongoDB upsert
      const userMock = mock.method(User, 'findOneAndUpdate', async (filter, update, options) => {
        const email = filter.email;
        let doc = mockUserStore.get(email);
        if (!doc) {
          doc = {
            _id: update.$setOnInsert?._id || new mongoose.Types.ObjectId(),
            email,
            ...update.$set
          };
          mockUserStore.set(email, doc);
        } else {
          Object.assign(doc, update.$set);
        }
        return doc;
      });

      const positionMock = mock.method(LivePosition, 'findOneAndUpdate', async (filter, update, options) => {
        const userId = String(filter.userId);
        let doc = mockPositionStore.get(userId);
        if (!doc) {
          doc = {
            _id: new mongoose.Types.ObjectId(),
            userId: filter.userId,
            ...update.$set
          };
          mockPositionStore.set(userId, doc);
        } else {
          Object.assign(doc, update.$set);
        }
        return doc;
      });

      try {
        const testUsers = generate60TestUsers(dummyOfficeId);

        // --- FIRST SEED EXECUTION ---
        const firstRun = await upsertTestUsersAndPositions(testUsers, dummyOfficeId);
        assert.strictEqual(firstRun.users.length, 60, 'First run should seed 60 users');
        assert.strictEqual(firstRun.positions.length, 60, 'First run should seed 60 positions');
        assert.strictEqual(mockUserStore.size, 60, 'User store should have 60 users after first run');
        assert.strictEqual(mockPositionStore.size, 60, 'Position store should have 60 positions after first run');

        // Capture user IDs from first run
        const firstRunUserIds = firstRun.users.map((u) => String(u._id));

        // --- SECOND SEED EXECUTION (REPEATED SEEDING) ---
        const secondRun = await upsertTestUsersAndPositions(testUsers, dummyOfficeId);
        assert.strictEqual(secondRun.users.length, 60, 'Second run should process 60 users');
        assert.strictEqual(secondRun.positions.length, 60, 'Second run should process 60 positions');

        // Assert NO duplicate records were created
        assert.strictEqual(mockUserStore.size, 60, 'User store must STILL contain exactly 60 users (no duplicates)');
        assert.strictEqual(mockPositionStore.size, 60, 'Position store must STILL contain exactly 60 positions (no duplicates)');

        // Assert existing records were reused and ObjectIds were preserved
        const secondRunUserIds = secondRun.users.map((u) => String(u._id));
        assert.deepStrictEqual(
          secondRunUserIds,
          firstRunUserIds,
          'User ObjectIds must be strictly preserved across repeated seed operations'
        );

        // Verify each position is correctly linked to the preserved user _id
        for (const pos of secondRun.positions) {
          assert.ok(firstRunUserIds.includes(String(pos.userId)), 'Position must reference preserved user _id');
        }
      } finally {
        userMock.mock.restore();
        positionMock.mock.restore();
      }
    });

    it('should reset avatar position to benchmark coordinates when avatar has moved', async () => {
      const mockUserStore = new Map();
      const mockPositionStore = new Map();

      const userMock = mock.method(User, 'findOneAndUpdate', async (filter, update) => {
        const email = filter.email;
        let doc = mockUserStore.get(email);
        if (!doc) {
          doc = { _id: update.$setOnInsert?._id || new mongoose.Types.ObjectId(), email, ...update.$set };
          mockUserStore.set(email, doc);
        } else {
          Object.assign(doc, update.$set);
        }
        return doc;
      });

      const positionMock = mock.method(LivePosition, 'findOneAndUpdate', async (filter, update) => {
        const userId = String(filter.userId);
        let doc = mockPositionStore.get(userId);
        if (!doc) {
          doc = { _id: new mongoose.Types.ObjectId(), userId: filter.userId, ...update.$set };
          mockPositionStore.set(userId, doc);
        } else {
          Object.assign(doc, update.$set);
        }
        return doc;
      });

      try {
        const testUsers = generate60TestUsers(dummyOfficeId);
        const originalUser1Location = [...testUsers[0].location];

        // Seed once
        const firstRun = await upsertTestUsersAndPositions(testUsers, dummyOfficeId);
        const user1Id = String(firstRun.users[0]._id);

        // Simulate user 1 moving their avatar to [350, 400] and going offline
        mockPositionStore.get(user1Id).location = [350, 400];
        mockUserStore.get(testUsers[0].email).isOnline = false;

        assert.deepStrictEqual(mockPositionStore.get(user1Id).location, [350, 400]);
        assert.strictEqual(mockUserStore.get(testUsers[0].email).isOnline, false);

        // Re-run seed
        await upsertTestUsersAndPositions(testUsers, dummyOfficeId);

        // Position should be reset back to benchmark initial location and brought online
        assert.deepStrictEqual(
          mockPositionStore.get(user1Id).location,
          originalUser1Location,
          'Seeding must reset avatar location back to deterministic benchmark coordinates'
        );
        assert.strictEqual(
          mockUserStore.get(testUsers[0].email).isOnline,
          true,
          'Seeding must mark test users online'
        );
      } finally {
        userMock.mock.restore();
        positionMock.mock.restore();
      }
    });

    it('should execute seedDatabase safely in offline mode and return valid office and 60 users', async () => {
      const result = await seedDatabase({ disconnectOnExit: false });

      assert.ok(result.office, 'Must return office object');
      assert.strictEqual(result.office.code, 'office-01');
      assert.strictEqual(result.office.dimensions.width, 1000);
      assert.strictEqual(result.office.dimensions.height, 600);
      assert.strictEqual(result.office.proximityRadius, 100);
      assert.strictEqual(result.office.zones.length, 4);
      assert.strictEqual(result.office.obstacles.length, 14);

      assert.ok(Array.isArray(result.testUsers), 'Must return testUsers array');
      assert.strictEqual(result.testUsers.length, 60, 'Must return 60 test users');
    });
  });
});
