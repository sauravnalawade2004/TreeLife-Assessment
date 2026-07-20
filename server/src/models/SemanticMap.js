import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  tenantId: { type: String, required: true, unique: true, index: true },
  version: { type: Number, default: 1 },
  status: { type: String, default: 'compiled' },
  sourceProfiles: mongoose.Schema.Types.Mixed,
  glossary: mongoose.Schema.Types.Mixed,
  fieldHypotheses: mongoose.Schema.Types.Mixed,
  warnings: [String],
  stats: mongoose.Schema.Types.Mixed,
  ai: mongoose.Schema.Types.Mixed,
  compiledAt: { type: Date, default: Date.now }
}, { timestamps: true, versionKey: false });

export const SemanticMapModel = mongoose.models.SemanticMap || mongoose.model('SemanticMap', schema);
