const mongoose = require('mongoose');

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
            type: [Number],
            required: true,
            validate: {
                validator: function (val) {
                    return Array.isArray(val) && val.length === 2;
                },
                message: 'location must be an array of two numbers: [x, y]'
            }
        },
        lastUpdated: {
            type: Date,
            default: Date.now
        }
    },
    { timestamps: true }
);

// compound planar index for fast spatial lookup per office
livePositionSchema.index({ officeId: 1, location: '2d' });

module.exports = mongoose.model('LivePosition', livePositionSchema);