const mongoose = require('mongoose');

const wifiDataSchema = new mongoose.Schema({
  wifiName: {
    type: String,
    required: true,
    trim: true,
  },
  wifiPassword: {
    type: String,
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('wifi-data', wifiDataSchema);
