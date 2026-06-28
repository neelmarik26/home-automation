const mongoose = require("mongoose");

const buttonSchema = new mongoose.Schema({
  buttonName: String,
  state: String,       // "ON" / "OFF" or whatever you send
  timestamp: { type: Date, default: Date.now },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "user", // Name used in mongoose.model("User", userSchema)
    required: true,
  },
});

module.exports = mongoose.model("ButtonState", buttonSchema);