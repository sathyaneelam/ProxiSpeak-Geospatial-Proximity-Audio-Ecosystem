const positionService = require('./positionService');
const officeService = require('./officeService');
const userService = require('./userService');

module.exports = {
  ...positionService,
  ...officeService,
  ...userService,
  positionService,
  officeService,
  userService
};
