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
});
