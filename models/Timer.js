const mongoose = require('mongoose');

const timerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true,
  },
  buttonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ButtonState',
    required: true,
  },
  buttonName: {
    type: String,
    required: true,
  },
  action: {
    type: String,
    enum: ['ON', 'OFF'],
    required: true,
  },
  durationMinutes: {
    type: Number,
    required: true,
  },
  targetTime: {
    type: Date,
    required: true,
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
    default: 'ACTIVE',
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Timer', timerSchema);
