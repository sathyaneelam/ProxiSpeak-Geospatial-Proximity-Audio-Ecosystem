const mongoose = require('mongoose');

/**
 * LivePosition Schema
 *
 * PLANAR 2D GEOSPATIAL REPRESENTATION:
 * The ProxiSpeak virtual world is a flat 2D Cartesian plane measured in screen/canvas pixels (e.g., 1000x600).
 * We explicitly choose MongoDB's '2d' planar index rather than '2dsphere' because:
 *   1. '2dsphere' operates on WGS84 spherical coordinates (longitude [-180, 180], latitude [-90, 90]).
 *      Screen pixel coordinates (e.g. [500, 300]) would fail spherical validation or distort distance.
 *   2. Planar '2d' index computes exact Euclidean planar distance: sqrt((x2 - x1)^2 + (y2 - y1)^2),
 *      which corresponds 1:1 with virtual office pixel distance and proximity radius.
 *   3. The compound index { officeId: 1, location: '2d' } enables single-query spatial lookup filtered
 *      by office, preventing cross-office audio leakage.
 */
const livePositionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true
        },
        officeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Office',
            required: true,
            index: true
        },
        location: {
            type: [Number], // [x, y] in planar pixels
            required: [true, 'location is required'],
            validate: {
                validator: function (val) {
                    return (
                        Array.isArray(val) &&
                        val.length === 2 &&
                        typeof val[0] === 'number' &&
                        !isNaN(val[0]) &&
                        isFinite(val[0]) &&
                        val[0] >= 0 &&
                        typeof val[1] === 'number' &&
                        !isNaN(val[1]) &&
                        isFinite(val[1]) &&
                        val[1] >= 0
                    );
                },
                message: 'location must be an array of two non-negative finite numbers: [x, y]'
            }
        },
        socketId: {
            type: String,
            default: null,
            index: true
        },
        lastUpdated: {
            type: Date,
            default: Date.now
        }
    },
    { timestamps: true }
);

// Automatically synchronize lastUpdated timestamp on document mutation
livePositionSchema.pre('save', function (next) {
    if (this.isModified('location') || this.isModified('officeId')) {
        this.lastUpdated = new Date();
    }
    if (typeof next === 'function') next();
});

/**
 * Calculate planar Euclidean distance from this position to a target [x, y] coordinate pair.
 *
 * @param {[number, number]} targetLocation - [x, y] target coordinates
 * @returns {number} Distance in planar canvas pixels
 */
livePositionSchema.methods.calculateDistanceTo = function (targetLocation) {
    if (
        !Array.isArray(targetLocation) ||
        targetLocation.length !== 2 ||
        typeof targetLocation[0] !== 'number' ||
        !isFinite(targetLocation[0]) ||
        typeof targetLocation[1] !== 'number' ||
        !isFinite(targetLocation[1])
    ) {
        throw new Error('Target location must be a 2-element array of finite numbers [x, y]');
    }
    const dx = targetLocation[0] - this.location[0];
    const dy = targetLocation[1] - this.location[1];
    return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Check if another [x, y] location is within a given proximity radius (default 100px).
 *
 * @param {[number, number]} targetLocation - [x, y] target coordinates
 * @param {number} [radius=100] - Proximity threshold in pixels
 * @returns {boolean} True if within radius
 */
livePositionSchema.methods.isWithinProximity = function (targetLocation, radius = 100) {
    const dist = this.calculateDistanceTo(targetLocation);
    return dist <= (typeof radius === 'number' && radius > 0 ? radius : 100);
};

// Compound planar index for high-throughput spatial proximity lookups partitioned by office
livePositionSchema.index({ officeId: 1, location: '2d' });

module.exports = mongoose.model('LivePosition', livePositionSchema);
