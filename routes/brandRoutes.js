const express = require('express');
const router = express.Router();
const {
  createBrand,
  getAllBrands,
  getDefaultBrand,
  getBrandById,
  updateBrand,
  setDefaultBrand,
  deleteBrand
} = require('../actions/brandActions');
const { authenticateToken } = require('../middleware/auth');

// All brand routes are protected
router.post('/', authenticateToken, createBrand);
router.get('/', authenticateToken, getAllBrands);
router.get('/default', authenticateToken, getDefaultBrand);
router.get('/:id', authenticateToken, getBrandById);
router.put('/:id', authenticateToken, updateBrand);
router.put('/:id/set-default', authenticateToken, setDefaultBrand);
router.delete('/:id', authenticateToken, deleteBrand);

module.exports = router;
