const mongoose = require("mongoose");

const userdataschem = new mongoose.Schema({
    name: String,
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        validate: {
            validator: function (email) {
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
            },
            message: 'Please enter a valid email address'
        }
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [8, 'Password must be at least 8 characters']
    },
    passwordResetOtp: {
        type: String,
        default: null
    },
    passwordResetOtpExpiresAt: {
        type: Date,
        default: null
    },
    type: {
        type: String,
        enum: ['USER', 'ADMIN'],
        default: 'USER'
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'BLOCKED'],
        default: 'ACTIVE'
    },
    deviceId: {
        type: String,
        default: null,
        unique: true,
        sparse: true
    },
    deviceStatus: {
        type: String,
        enum: ['ONLINE', 'OFFLINE'],
        default: 'OFFLINE'
    }
},{
    timestamps: true
});
const user = mongoose.model("user", userdataschem);
module.exports = user;
