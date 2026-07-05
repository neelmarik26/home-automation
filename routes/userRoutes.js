const express = require('express');

const decodeJwtToken = require('../middleware/jwtmiddleware');
const userController = require('../controllers/userController');
const wifiController = require('../controllers/wifiController');

const router = express.Router();

router.post(['/register', '/newuser'], userController.registerUser);
router.post(['/login', '/olduser'], userController.loginUser);
router.get(['/button-status', '/getbuttonstatus'], decodeJwtToken, userController.getButtonStatusByUser);
router.put(['/button-status/:buttonId'], decodeJwtToken, userController.updateButtonStatusByUser);
router.post('/wifi-data', decodeJwtToken, wifiController.storeWifiData);
router.get('/wifi-data', decodeJwtToken, wifiController.listWifiData);
router.post('/sendmail', userController.sendForgotPasswordOtp);
router.post('/verify-otp', userController.verifyOtp);
router.post('/cpass', userController.verifyOtpAndResetPassword);

module.exports = router;
