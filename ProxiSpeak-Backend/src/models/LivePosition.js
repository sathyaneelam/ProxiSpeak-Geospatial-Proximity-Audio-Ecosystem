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
            required: true,
            validate: {
                validator: function (val) {
                    return (
                        Array.isArray(val) &&
                        val.length === 2 &&
                        typeof val[0] === 'number' &&
                        !isNaN(val[0]) &&
                        isFinite(val[0]) &&
                        typeof val[1] === 'number' &&
                        !isNaN(val[1]) &&
                        isFinite(val[1])
                    );
                },
                message: 'location must be an array of two finite numbers: [x, y]'
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

// Compound planar index for high-throughput spatial proximity lookups partitioned by office
livePositionSchema.index({ officeId: 1, location: '2d' });

module.exports = mongoose.model('LivePosition', livePositionSchema);