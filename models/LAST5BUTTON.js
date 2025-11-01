const mongoose = require("mongoose");

const buttonSchema = new mongoose.Schema({
  buttonName: String,
  state: String,       // "ON" / "OFF" or whatever you send
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model("ButtonState", buttonSchema);