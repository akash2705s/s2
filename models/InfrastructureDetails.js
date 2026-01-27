const mongoose = require('mongoose');

const infrastructureDetailsSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  infrastructure_type: {
    type: String,
    required: true,
    enum: ['CDN', 'Cloud', 'Data Center'],
    default: 'Cloud'
  },
  capacity_metrics: {
    type: String,
    required: false,
    trim: true
  },
  sla_agreement_level: {
    type: String,
    required: true,
    enum: ['Standard', 'Premium'],
    default: 'Standard'
  },
  monitoring_tools_integrated: {
    type: [String],
    required: false,
    default: []
  }
}, {
  timestamps: true
});

// Note: user_id already has unique: true which creates an index automatically

const InfrastructureDetails = mongoose.model('InfrastructureDetails', infrastructureDetailsSchema);

module.exports = InfrastructureDetails;
