const mongoose = require("mongoose");

const buttonSchema = new mongoose.Schema({
  buttonName: String, 
  customName: {
    type: String,
    default: null
  },
  customRoom: {
    type: String,
    default: null
  },
  state: String,
  type: {
    type: String,
    required: true,
    default: "USER"
  },
  timestamp: { type: Date, default: Date.now },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "user", // Name used in mongoose.model("User", userSchema)
    required: true,
  },
});

module.exports = mongoose.model("ButtonState", buttonSchema);
