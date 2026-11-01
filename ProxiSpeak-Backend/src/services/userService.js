const User = require('../models/User');

/**
 * Find or create a user by email address.
 */
async function findOrCreateUser({
  email,
  displayName = 'Anonymous',
  avatarColor = '#3b82f6',
  avatarUrl = ''
}) {
  if (!email) throw new Error('Email is required');
  const normalizedEmail = email.toLowerCase().trim();

  let user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    user = await User.create({
      email: normalizedEmail,
      displayName: displayName.trim(),
      avatarColor,
      avatarUrl,
      isOnline: true,
      lastActive: new Date()
    });
  }
  return user;
}

/**
 * Update user online presence and current active office.
 */
async function updateUserPresence(userId, isOnline, currentOfficeId = null) {
  if (!userId) return null;
  return await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        isOnline: Boolean(isOnline),
        currentOfficeId: isOnline ? currentOfficeId : null,
        lastActive: new Date()
      }
    },
    { new: true }
  );
}

/**
 * Retrieve user by ID.
 */
async function getUserById(userId) {
  if (!userId) return null;
  return await User.findById(userId);
}

module.exports = {
  findOrCreateUser,
  updateUserPresence,
  getUserById
};
