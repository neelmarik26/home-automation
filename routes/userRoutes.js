const express = require('express');

const decodeJwtToken = require('../middleware/jwtmiddleware');
const userController = require('../controllers/userController');
const wifiController = require('../controllers/wifiController');

const router = express.Router();

router.post('/register', userController.registerUser);
router.post('/login', userController.loginUser);
router.get('/button-status', decodeJwtToken, userController.getButtonStatusByUser);
router.get('/device-status', decodeJwtToken, userController.getDeviceStatus);
router.put('/button-status/:buttonId', decodeJwtToken, userController.updateButtonStatusByUser);
router.get('/device-names', decodeJwtToken, userController.getDeviceNames);
router.put('/device-names', decodeJwtToken, userController.updateDeviceName);
router.post('/wifi-data', decodeJwtToken, wifiController.storeWifiData);
router.get('/wifi-data', decodeJwtToken, wifiController.listWifiData);
router.post('/sendmail', userController.sendForgotPasswordOtp);
router.post('/verify-otp', userController.verifyOtp);
router.post('/cpass', userController.verifyOtpAndResetPassword);

module.exports = router;
