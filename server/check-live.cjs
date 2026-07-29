const mongoose = require('mongoose');
require('dotenv').config();
const {BusinessTruthModel} = require('./src/models/BusinessTruth.js');
const {SemanticMapModel} = require('./src/models/SemanticMap.js');

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to:', mongoose.connection.name);
  
  const map = await SemanticMapModel.findOne({tenantId: 'acme-law'}).lean();
  console.log('Semantic map version:', map?.version);
  console.log('Semantic map compiledAt:', map?.compiledAt);
  console.log('Glossary people:', JSON.stringify(map?.glossary?.people, null, 2));
  
  const truths = await BusinessTruthModel.find({tenantId: 'acme-law', topic: 'crm_deals'}).lean();
  console.log('\nTotal crm_deals BusinessTruth records:', truths.length);
  
  // Show first 10 with owners
  truths.slice(0, 10).forEach((t, i) => {
    console.log('\n--- Record ' + (i+1) + ' ---');
    console.log('truthId:', t.truthId);
    console.log('client:', t.client);
    console.log('owners:', t.owners);
    console.log('ownerAliases:', t.ownerAliases);
    console.log('state:', t.state);
    console.log('sources:', t.sources);
  });
  
  // Count unique owners
  const allOwners = new Set();
  truths.forEach(t => {
    (t.owners || []).forEach(o => allOwners.add(o));
    (t.ownerAliases || []).forEach(o => allOwners.add(o));
  });
  console.log('\nAll unique owners/aliases:', [...allOwners].sort());
  
  // Check Garima specifically
  const garimaRecords = truths.filter(t => 
    (t.owners && t.owners.some(o => o.toLowerCase().includes('garima'))) ||
    (t.ownerAliases && t.ownerAliases.some(o => o.toLowerCase().includes('garima')))
  );
  console.log('\nRecords matching Garima:', garimaRecords.length);
  garimaRecords.forEach((t, i) => {
    console.log('  ' + (i+1) + '. ' + t.client + ' (' + t.truthId + ') owners=' + JSON.stringify(t.owners) + ' aliases=' + JSON.stringify(t.ownerAliases));
  });
  
  await mongoose.disconnect();
}
check().catch(console.error);