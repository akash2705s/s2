const mongoose = require('mongoose');

const dspDetailsSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  dsp_platform_name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100
  },
  budget_allocation_method: {
    type: String,
    required: true,
    enum: ['CPM', 'CPC', 'CPA'],
    default: 'CPM'
  },
  target_audience_segments: {
    type: [String],
    required: false,
    default: []
  },
  integration_tokens: {
    type: [String],
    required: false,
    default: []
  }
}, {
  timestamps: true
});

// Note: user_id already has unique: true which creates an index automatically

const DSPDetails = mongoose.model('DSPDetails', dspDetailsSchema);

module.exports = DSPDetails;
