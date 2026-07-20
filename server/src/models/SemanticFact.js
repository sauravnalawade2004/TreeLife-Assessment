import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  factId: { type: String, required: true },
  source: { type: String, required: true, index: true },
  sourceRecordId: { type: String, required: true },
  objectType: { type: String, default: 'business_item', index: true },
  topic: { type: String, default: 'unknown', index: true },
  client: String,
  ownerRaw: String,
  ownerCanonical: String,
  lifecycleClaim: { type: String, enum: ['completed', 'open', 'cancelled', 'unknown'], default: 'unknown' },
  period: String,
  eventDate: Date,
  reference: String,
  lineageKey: { type: String, index: true },
  evidenceType: String,
  evidenceStrength: { type: Number, min: 0, max: 1, default: 0.3 },
  path: String,
  text: String,
  extractedBy: String,
  extractionConfidence: { type: Number, min: 0, max: 1, default: 0.5 },
  rawEvidence: mongoose.Schema.Types.Mixed
}, { timestamps: true, versionKey: false });

schema.index({ tenantId: 1, factId: 1 }, { unique: true });
schema.index({ tenantId: 1, topic: 1, lifecycleClaim: 1 });
export const SemanticFactModel = mongoose.models.SemanticFact || mongoose.model('SemanticFact', schema);
