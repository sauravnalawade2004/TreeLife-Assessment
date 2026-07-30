import '../src/load-env.js';
import mongoose from 'mongoose';
import { BusinessTruthModel } from '../src/models/BusinessTruth.js';

const tenantId = process.argv[2] || 'acme-law';

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not configured. Add it to server/.env and retry.');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
console.log('Connected to:', mongoose.connection.name);

const records = await BusinessTruthModel.find({
  tenantId,
  $or: [
    { owners: { $regex: /garima/i } },
    { ownerAliases: { $regex: /garima/i } }
  ]
}).limit(3).lean();

console.log(`Found ${records.length} Garima-related BusinessTruth records for tenant ${tenantId}`);
for (const record of records) {
  console.log('---');
  console.log('truthId:', record.truthId);
  console.log('client:', record.client);
  console.log('topic:', record.topic);
  console.log('owners (raw):', JSON.stringify(record.owners));
  console.log('ownerAliases (raw):', JSON.stringify(record.ownerAliases));
}

await mongoose.disconnect();
