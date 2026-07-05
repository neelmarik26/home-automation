const express = require('express');

const decodeJwtToken = require('../middleware/jwtmiddleware');
const adminController = require('../controllers/adminController');

const router = express.Router();

router.get('/users', decodeJwtToken, adminController.listUsers);
router.delete('/user/:id', decodeJwtToken, adminController.deleteUser);
router.post('/add-admin', decodeJwtToken, adminController.addAdmin);
router.post('/block-user', decodeJwtToken, adminController.blockUser);

module.exports = router;
