const { describe, it } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const LivePosition = require('../../src/models/LivePosition');

describe('LivePosition Schema & Index Validation', () => {
  const dummyUserId = new mongoose.Types.ObjectId();
  const dummyOfficeId = new mongoose.Types.ObjectId();

  it('should validate a correct 2D planar coordinate pair [x, y]', async () => {
    const position = new LivePosition({
      userId: dummyUserId,
      officeId: dummyOfficeId,
      location: [500, 300],
      socketId: 'sock_abc123'
    });

    await position.validate();
    assert.deepStrictEqual(position.location, [500, 300]);
    assert.strictEqual(position.officeId, dummyOfficeId);
    assert.strictEqual(position.userId, dummyUserId);
    assert.strictEqual(position.socketId, 'sock_abc123');
    assert.ok(position.lastUpdated instanceof Date);
  });

  it('should fail validation when userId is missing', async () => {
    const position = new LivePosition({
      officeId: dummyOfficeId,
      location: [100, 200]
    });

    await assert.rejects(
      async () => await position.validate(),
      (err) => err.errors && Boolean(err.errors.userId)
    );
  });

  it('should fail validation when officeId is missing', async () => {
    const position = new LivePosition({
      userId: dummyUserId,
      location: [100, 200]
    });

    await assert.rejects(
      async () => await position.validate(),
      (err) => err.errors && Boolean(err.errors.officeId)
    );
  });

  it('should fail validation when location is missing, null, or empty', async () => {
    const missingLocation = new LivePosition({
      userId: dummyUserId,
      officeId: dummyOfficeId
    });

    await assert.rejects(
      async () => await missingLocation.validate(),
      (err) => err.errors && Boolean(err.errors.location)
    );

    const nullLocation = new LivePosition({
      userId: dummyUserId,
      officeId: dummyOfficeId,
      location: null
    });

    await assert.rejects(
      async () => await nullLocation.validate(),
      (err) => err.errors && Boolean(err.errors.location)
    );

    const emptyLocation = new LivePosition({
      userId: dummyUserId,
      officeId: dummyOfficeId,
      location: []
    });

    await assert.rejects(
      async () => await emptyLocation.validate(),
      (err) => err.errors && Boolean(err.errors.location)
    );
  });

  it('should reject coordinates that are not arrays or do not have exactly 2 valid numbers', async () => {
    const invalidTestCases = [
      [100],
      [100, 200, 300],
      ['invalid_x', 'invalid_y'],
      [NaN, 200],
      [100, Infinity]
    ];

    for (const invalidLocation of invalidTestCases) {
      const position = new LivePosition({
        userId: dummyUserId,
        officeId: dummyOfficeId,
        location: invalidLocation
      });

      await assert.rejects(
        async () => await position.validate(),
        (err) => Boolean(err),
        `Expected validation error for invalid location: ${JSON.stringify(invalidLocation)}`
      );
    }
  });

  it('should reject negative coordinates outside the planar canvas domain', async () => {
    const negativeCoordinates = [
      [-10, 200],
      [100, -50],
      [-1, -1]
    ];

    for (const invalidLocation of negativeCoordinates) {
      const position = new LivePosition({
        userId: dummyUserId,
        officeId: dummyOfficeId,
        location: invalidLocation
      });

      await assert.rejects(
        async () => await position.validate(),
        (err) => err.errors && Boolean(err.errors.location),
        `Expected validation error for negative location: ${JSON.stringify(invalidLocation)}`
      );
    }
  });

  it('should accept canvas origin [0, 0] as valid coordinates', async () => {
    const position = new LivePosition({
      userId: dummyUserId,
      officeId: dummyOfficeId,
      location: [0, 0]
    });

    await position.validate();
    assert.deepStrictEqual(position.location, [0, 0]);
  });

  it('should have compound 2D planar index configured on { officeId: 1, location: "2d" }', () => {
    const indexes = LivePosition.schema.indexes();
    const hasCompound2dIndex = indexes.some(([fields]) => {
      return fields.officeId === 1 && fields.location === '2d';
    });

    assert.ok(
      hasCompound2dIndex,
      'Schema must define compound planar index { officeId: 1, location: "2d" }'
    );
  });

  it('should have required indexes configured for officeId and unique userId', () => {
    const indexes = LivePosition.schema.indexes();

    const hasUserIdUniqueIndex = indexes.some(([fields, options]) => {
      return fields.userId === 1 && options && options.unique === true;
    });
    assert.ok(
      hasUserIdUniqueIndex,
      'Schema must define unique index on { userId: 1 } for 1:1 user live position mapping'
    );

    const hasOfficeIdIndex = indexes.some(([fields]) => {
      return fields.officeId === 1 && Object.keys(fields).length === 1;
    });
    assert.ok(
      hasOfficeIdIndex,
      'Schema must define single-field index on { officeId: 1 } for office-level avatar queries'
    );
  });

  it('should associate live position with an office via officeId and enforce unique userId schema reference', () => {
    const userIdPath = LivePosition.schema.paths.userId;
    const officeIdPath = LivePosition.schema.paths.officeId;

    assert.strictEqual(officeIdPath.options.ref, 'Office', 'officeId must reference Office model');
    assert.strictEqual(officeIdPath.options.required, true, 'officeId is required');
    assert.strictEqual(userIdPath.options.ref, 'User', 'userId must reference User model');
    assert.strictEqual(userIdPath.options.required, true, 'userId is required');
    assert.strictEqual(userIdPath.options.unique, true, 'userId must be unique in schema');
  });

  it('should support in-place coordinate updates on LivePosition instance and maintain schema validity', async () => {
    const position = new LivePosition({
      userId: dummyUserId,
      officeId: dummyOfficeId,
      location: [100, 200],
      socketId: 'sock_original'
    });

    await position.validate();
    assert.deepStrictEqual(position.location, [100, 200]);

    // Mutate location in-place
    position.location = [350, 450];
    position.lastUpdated = new Date();
    await position.validate();
    assert.deepStrictEqual(position.location, [350, 450]);

    // Ensure invalid updated coordinates are caught
    position.location = [-10, 450];
    await assert.rejects(
      async () => await position.validate(),
      (err) => err.errors && Boolean(err.errors.location)
    );
  });
});

