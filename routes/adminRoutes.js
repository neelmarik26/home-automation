const express = require('express');

const decodeJwtToken = require('../middleware/jwtmiddleware');
const requireAdmin = require('../middleware/requireAdmin');
const adminController = require('../controllers/adminController');

const router = express.Router();

router.get('/users', decodeJwtToken, requireAdmin, adminController.listUsers);
router.delete('/user/:id', decodeJwtToken, requireAdmin, adminController.deleteUser);
router.post('/add-admin', decodeJwtToken, requireAdmin, adminController.addAdmin);
router.post('/block-user', decodeJwtToken, requireAdmin, adminController.blockUser);
router.post('/unblock-user', decodeJwtToken, requireAdmin, adminController.unblockUser);
router.post('/make-first-admin', adminController.makeFirstAdmin);
router.post('/promote-to-admin/:id', decodeJwtToken, requireAdmin, adminController.promoteToAdmin);
router.post('/remove-admin/:id', decodeJwtToken, requireAdmin, adminController.removeAdmin);

module.exports = router;
