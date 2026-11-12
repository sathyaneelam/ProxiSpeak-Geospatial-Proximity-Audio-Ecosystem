const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
    {
        displayName: {
            type: String,
            required: true,
            trim: true
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },
        avatarColor: {
            type: String,
            default: '#3b82f6',
            trim: true
        },
        avatarUrl: {
            type: String,
            default: '',
            trim: true
        },
        currentOfficeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Office',
            default: null
        },
        isOnline: {
            type: Boolean,
            default: false
        },
        lastActive: {
            type: Date,
            default: Date.now
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);