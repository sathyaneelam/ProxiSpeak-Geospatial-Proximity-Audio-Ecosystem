const { describe, it } = require('node:test');
const assert = require('node:assert');
const User = require('../../src/models/User');

describe('User Schema Validation', () => {
  it('should validate a complete and valid user document', async () => {
    const validUser = new User({
      displayName: 'Alice Engineer',
      email: 'alice@proxispeak.local',
      avatarColor: '#10b981',
      avatarUrl: 'https://example.com/alice.png',
      isOnline: true
    });

    await validUser.validate();
    assert.strictEqual(validUser.displayName, 'Alice Engineer');
    assert.strictEqual(validUser.email, 'alice@proxispeak.local');
    assert.strictEqual(validUser.isOnline, true);
    assert.strictEqual(validUser.avatarColor, '#10b981');
  });

  it('should fail validation when displayName is missing', async () => {
    const user = new User({ email: 'noname@proxispeak.local' });
    await assert.rejects(
      async () => await user.validate(),
      (err) => err.errors && Boolean(err.errors.displayName)
    );
  });

  it('should fail validation when email is missing', async () => {
    const user = new User({ displayName: 'Bob' });
    await assert.rejects(
      async () => await user.validate(),
      (err) => err.errors && Boolean(err.errors.email)
    );
  });

  it('should trim and lowercase email address', () => {
    const user = new User({
      displayName: '  Charlie Developer  ',
      email: '  CHARLIE@PROXISPEAK.LOCAL  '
    });

    assert.strictEqual(user.displayName, 'Charlie Developer');
    assert.strictEqual(user.email, 'charlie@proxispeak.local');
  });

  it('should apply correct defaults for optional fields', () => {
    const user = new User({
      displayName: 'Dave',
      email: 'dave@proxispeak.local'
    });

    assert.strictEqual(user.isOnline, false);
    assert.strictEqual(user.avatarColor, '#3b82f6');
    assert.strictEqual(user.avatarUrl, '');
    assert.strictEqual(user.currentOfficeId, null);
    assert.ok(user.lastActive instanceof Date);
  });
});
