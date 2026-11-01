const Office = require('../models/Office');

// Default layout zones matching frontend visual canvas specifications
const DEFAULT_ROOM_ZONES = [
  {
    name: 'Workstation A',
    title: 'WORKSTATION A',
    subtitle: 'Focus desks + quiet work',
    x: 45,
    y: 45,
    w: 265,
    h: 205,
    fill: '#13273a',
    stroke: '#2d5676'
  },
  {
    name: 'Workstation B',
    title: 'WORKSTATION B',
    subtitle: 'Team workspace',
    x: 690,
    y: 45,
    w: 265,
    h: 205,
    fill: '#15293d',
    stroke: '#315d7f'
  },
  {
    name: 'Meeting Area',
    title: 'MEETING AREA',
    subtitle: 'Collaborative discussion zone',
    x: 45,
    y: 350,
    w: 300,
    h: 205,
    fill: '#18283a',
    stroke: '#3e5f82'
  },
  {
    name: 'Lounge',
    title: 'LOUNGE',
    subtitle: 'Relax + informal talks',
    x: 650,
    y: 350,
    w: 305,
    h: 205,
    fill: '#1b2940',
    stroke: '#47688e'
  }
];

// Default furniture obstacles matching collision boundaries
const DEFAULT_OBSTACLES = [
  // Workstation A desks
  { x: 78, y: 92, w: 72, h: 28, type: 'desk', label: 'Desk A1' },
  { x: 172, y: 92, w: 72, h: 28, type: 'desk', label: 'Desk A2' },
  { x: 78, y: 160, w: 72, h: 28, type: 'desk', label: 'Desk A3' },
  { x: 172, y: 160, w: 72, h: 28, type: 'desk', label: 'Desk A4' },

  // Workstation B desks
  { x: 724, y: 92, w: 72, h: 28, type: 'desk', label: 'Desk B1' },
  { x: 818, y: 92, w: 72, h: 28, type: 'desk', label: 'Desk B2' },
  { x: 724, y: 160, w: 72, h: 28, type: 'desk', label: 'Desk B3' },
  { x: 818, y: 160, w: 72, h: 28, type: 'desk', label: 'Desk B4' },

  // Meeting room table
  { x: 130, y: 412, w: 130, h: 58, type: 'table', label: 'Conference Table' },

  // Lounge sofa + coffee table
  { x: 700, y: 420, w: 95, h: 34, type: 'sofa', label: 'Sofa North' },
  { x: 808, y: 420, w: 95, h: 34, type: 'sofa', label: 'Sofa East' },
  { x: 755, y: 485, w: 92, h: 34, type: 'coffee', label: 'Coffee Table' },

  // Decorative side counters
  { x: 445, y: 72, w: 110, h: 24, type: 'counter', label: 'Coffee Counter' },
  { x: 438, y: 520, w: 126, h: 20, type: 'counter', label: 'Sideboard' }
];

/**
 * Create or update an office with customizable dimensions, zones, and obstacles.
 */
async function createOrUpdateOffice({
  name = 'ProxiSpeak Headquarters',
  code = 'office-01',
  dimensions = { width: 1000, height: 600 },
  proximityRadius = 100,
  zones = DEFAULT_ROOM_ZONES,
  obstacles = DEFAULT_OBSTACLES,
  settings = {}
}) {
  const update = {
    name,
    code: code.toLowerCase().trim(),
    dimensions,
    proximityRadius,
    zones: zones && zones.length > 0 ? zones : DEFAULT_ROOM_ZONES,
    obstacles: obstacles && obstacles.length > 0 ? obstacles : DEFAULT_OBSTACLES,
    settings
  };

  return await Office.findOneAndUpdate(
    { code: update.code },
    { $set: update },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

/**
 * Get office by its code (e.g., 'office-01') or ObjectId.
 */
async function getOfficeByIdOrCode(identifier) {
  if (!identifier) return null;
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(String(identifier));
  if (isObjectId) {
    const byId = await Office.findById(identifier);
    if (byId) return byId;
  }
  return await Office.findOne({ code: String(identifier).toLowerCase().trim() });
}

/**
 * Seed or retrieve the default virtual office.
 */
async function seedDefaultOffice() {
  return await createOrUpdateOffice({
    name: 'ProxiSpeak Main Office',
    code: 'office-01',
    dimensions: { width: 1000, height: 600 },
    proximityRadius: 100,
    zones: DEFAULT_ROOM_ZONES,
    obstacles: DEFAULT_OBSTACLES
  });
}

module.exports = {
  DEFAULT_ROOM_ZONES,
  DEFAULT_OBSTACLES,
  createOrUpdateOffice,
  getOfficeByIdOrCode,
  seedDefaultOffice
};
