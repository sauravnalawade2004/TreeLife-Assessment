import '../src/load-env.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { BusinessTruthModel } from '../src/models/BusinessTruth.js';
import { SemanticMapModel } from '../src/models/SemanticMap.js';

const state = await connectDatabase({ seedIfEmpty: false });
if (!state.connected) throw new Error(`Database connection is required: ${state.error || 'MONGODB_URI is not configured'}`);

try {
  const [truths, map] = await Promise.all([
    BusinessTruthModel.find({ tenantId: 'acme-law', topic: 'crm_deals' }, { truthId: 1, owners: 1, ownerAliases: 1 }).limit(5).lean(),
    SemanticMapModel.findOne({ tenantId: 'acme-law' }, { 'glossary.people': 1 }).lean()
  ]);
  console.log(JSON.stringify({ crmDeals: truths, glossaryPeople: map?.glossary?.people || {} }, null, 2));
} finally {
  await disconnectDatabase();
}
