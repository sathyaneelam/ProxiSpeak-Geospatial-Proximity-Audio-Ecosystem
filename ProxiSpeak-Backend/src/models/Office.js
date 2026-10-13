const mongoose = require('mongoose');

const officeSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        dimensions: {
            width: { type: Number, required: true },
            height: { type: Number, required: true }
        },
        settings: {
            type: Map,
            of: String,
            default: {}
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model('Office', officeSchema);