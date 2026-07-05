const mongoose = require("mongoose");

const deviceConnectionSchema = new mongoose.Schema({
    deviceId: {
        type: String,
        required: true,
        unique: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    lastHeartbeat: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['ONLINE', 'OFFLINE'],
        default: 'OFFLINE'
    }
}, {
    timestamps: true
});

const DeviceConnection = mongoose.model("DeviceConnection", deviceConnectionSchema);
module.exports = DeviceConnection;
