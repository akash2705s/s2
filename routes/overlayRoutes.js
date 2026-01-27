const express = require('express');
const router = express.Router();
const {
  createElement,
  getAllElements,
  getElementById,
  updateElement,
  deleteElement
} = require('../actions/overlayActions');
const { authenticateToken } = require('../middleware/auth');
const { uploadMiddleware } = require('../middleware/upload');

// All overlay element routes are protected
router.post('/', authenticateToken, uploadMiddleware, createElement);
router.get('/', authenticateToken, getAllElements);
router.get('/:id', authenticateToken, getElementById);
router.put('/:id', authenticateToken, uploadMiddleware, updateElement);
router.delete('/:id', authenticateToken, deleteElement);

module.exports = router;
