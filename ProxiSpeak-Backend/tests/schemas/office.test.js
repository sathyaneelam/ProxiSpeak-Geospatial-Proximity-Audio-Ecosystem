const { describe, it } = require('node:test');
const assert = require('node:assert');
const Office = require('../../src/models/Office');

describe('Office Schema & Layout Validation', () => {
  it('should validate an office with default dimensions and proximity radius', async () => {
    const office = new Office({
      name: 'Main HQ',
      code: 'office-01'
    });

    await office.validate();
    assert.strictEqual(office.dimensions.width, 1000, 'Default width should be 1000px');
    assert.strictEqual(office.dimensions.height, 600, 'Default height should be 600px');
    assert.strictEqual(office.proximityRadius, 100, 'Default proximity radius should be 100px');
  });

  it('should fail validation when name or code is missing', async () => {
    const office = new Office({});
    await assert.rejects(
      async () => await office.validate(),
      (err) => err.errors && Boolean(err.errors.name && err.errors.code)
    );
  });

  it('should reject invalid dimensions or proximity radius below minimum', async () => {
    const office = new Office({
      name: 'Tiny Office',
      code: 'tiny-01',
      dimensions: { width: 50, height: 50 }, // min is 100
      proximityRadius: 5 // min is 10
    });

    await assert.rejects(
      async () => await office.validate(),
      (err) =>
        err.errors &&
        Boolean(
          err.errors['dimensions.width'] &&
          err.errors['dimensions.height'] &&
          err.errors.proximityRadius
        )
    );
  });

  it('should validate zones and obstacles within office layout', async () => {
    const office = new Office({
      name: 'Tech Campus',
      code: 'campus-01',
      zones: [
        {
          name: 'Workstation A',
          title: 'WORKSTATION A',
          subtitle: 'Focus desks',
          x: 45,
          y: 45,
          w: 265,
          h: 205
        }
      ],
      obstacles: [
        {
          x: 78,
          y: 92,
          w: 72,
          h: 28,
          type: 'desk',
          label: 'Desk A1'
        },
        {
          x: 130,
          y: 412,
          w: 130,
          h: 58,
          type: 'table',
          label: 'Conference Table'
        }
      ]
    });

    await office.validate();
    assert.strictEqual(office.zones.length, 1);
    assert.strictEqual(office.obstacles.length, 2);
    assert.strictEqual(office.obstacles[0].type, 'desk');
    assert.strictEqual(office.obstacles[1].type, 'table');
  });

  it('should reject invalid obstacle types not in enum', async () => {
    const office = new Office({
      name: 'Bad Furniture Office',
      code: 'bad-01',
      obstacles: [
        {
          x: 10,
          y: 10,
          w: 20,
          h: 20,
          type: 'spaceship' // invalid enum
        }
      ]
    });

    await assert.rejects(
      async () => await office.validate(),
      (err) => err.errors && Boolean(err.errors['obstacles.0.type'])
    );
  });

  it('should validate default office with complete set of furniture obstacles', async () => {
    const { DEFAULT_OBSTACLES, DEFAULT_ROOM_ZONES } = require('../../src/services/officeService');
    const office = new Office({
      name: 'ProxiSpeak Main Office',
      code: 'office-01',
      dimensions: { width: 1000, height: 600 },
      proximityRadius: 100,
      zones: DEFAULT_ROOM_ZONES,
      obstacles: DEFAULT_OBSTACLES
    });

    await office.validate();
    assert.strictEqual(office.obstacles.length, 14, 'Default office must seed 14 furniture obstacles');

    const obstacleTypes = office.obstacles.map((o) => o.type);
    assert.ok(obstacleTypes.filter((t) => t === 'desk').length >= 8, 'Must include at least 8 desks');
    assert.ok(obstacleTypes.includes('table'), 'Must include meeting table');
    assert.ok(obstacleTypes.includes('sofa'), 'Must include lounge sofas');
    assert.ok(obstacleTypes.includes('coffee'), 'Must include coffee table');
    assert.ok(obstacleTypes.includes('counter'), 'Must include counters');

    for (const obs of office.obstacles) {
      assert.ok(obs.x + obs.w <= 1000, `Obstacle ${obs.label} exceeds office width`);
      assert.ok(obs.y + obs.h <= 600, `Obstacle ${obs.label} exceeds office height`);
      assert.strictEqual(obs.isCollidable, true, 'Obstacles should be collidable by default');
    }
  });
});
