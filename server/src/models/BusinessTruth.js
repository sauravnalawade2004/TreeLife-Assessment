import mongoose from 'mongoose';

const evidenceSchema = new mongoose.Schema({
  factId: String,
  source: String,
  sourceRecordId: String,
  evidenceType: String,
  strength: Number,
  claim: String,
  text: String,
  path: String,
  url: String,
  lineageKey: String
}, { _id: false });

const schema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  truthId: { type: String, required: true },
  objectType: { type: String, default: 'business_item', index: true },
  topic: { type: String, required: true, index: true },
  client: String,
  owners: [String],
  ownerAliases: [String],
  state: { type: String, enum: ['completed', 'open', 'cancelled', 'unknown'], default: 'unknown', index: true },
  period: String,
  eventDate: Date,
  reference: String,
  sources: [String],
  sourceRecordIds: [String],
  evidence: [evidenceSchema],
  bestPath: String,
  bestUrl: String,
  conflict: { type: Boolean, default: false },
  confidence: { type: Number, min: 0, max: 1, default: 0.5 },
  explanation: [String],
  compiledAt: Date
}, { timestamps: true, versionKey: false });

schema.index({ tenantId: 1, truthId: 1 }, { unique: true });
schema.index({ tenantId: 1, topic: 1, state: 1 });
export const BusinessTruthModel = mongoose.models.BusinessTruth || mongoose.model('BusinessTruth', schema);
