const express = require('express');

const decodeJwtToken = require('../middleware/jwtmiddleware');
const timerController = require('../controllers/timerController');

const router = express.Router();

router.post('/create', decodeJwtToken, timerController.createTimer);
router.get('/active', decodeJwtToken, timerController.getActiveTimers);
router.delete('/cancel/:timerId', decodeJwtToken, timerController.cancelTimer);

module.exports = router;
