const express = require('express');

const decodeJwtToken = require('../middleware/jwtmiddleware');
const userController = require('../controllers/userController');
const wifiController = require('../controllers/wifiController');

const router = express.Router();

router.post(['/register', '/newuser'], userController.registerUser);
router.post(['/login', '/olduser'], userController.loginUser);
router.post(['/forgot-password', '/sendmail'], userController.sendForgotPasswordOtp);
router.post(['/verify-otp', '/cpass'], userController.verifyOtpAndResetPassword);
router.get(['/button-status', '/getbuttonstatus'], decodeJwtToken, userController.getButtonStatusByUser);
router.post('/wifi-data', decodeJwtToken, wifiController.storeWifiData);
router.get('/wifi-data', decodeJwtToken, wifiController.listWifiData);

module.exports = router;
