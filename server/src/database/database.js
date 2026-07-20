import mongoose from 'mongoose';
import {tenants,records,aliases} from '../data/tenants.js';
import {TenantModel} from '../models/Tenant.js';
import {BusinessRecordModel} from '../models/BusinessRecord.js';
import {AliasModel} from '../models/Alias.js';
import {repository} from '../repositories/demoRepository.js';

export const databaseState={mode:'memory',connected:false,database:null,error:null};
export async function connectDatabase({seedIfEmpty=true}={}){
  if(!process.env.MONGODB_URI) return databaseState;
  try{await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:12000});databaseState.mode='atlas';databaseState.connected=true;databaseState.database=mongoose.connection.name;databaseState.error=null;if(seedIfEmpty&&await TenantModel.estimatedDocumentCount()===0)await seedDatabase({replace:false});await hydrateRepository();return databaseState;}
  catch(error){databaseState.mode='memory-fallback';databaseState.connected=false;databaseState.error=error.message;console.error('Atlas unavailable; using safe in-memory fallback:',error.message);return databaseState;}
}
export async function seedDatabase({replace=true}={}){
  if(replace)await Promise.all([TenantModel.deleteMany({}),BusinessRecordModel.deleteMany({}),AliasModel.deleteMany({})]);
  await Promise.all([
    TenantModel.bulkWrite(tenants.map(t=>({updateOne:{filter:{tenantId:t.id},update:{$set:{tenantId:t.id,name:t.name,industry:t.industry,connectors:t.connectors}},upsert:true}}))),
    BusinessRecordModel.bulkWrite(records.map(r=>({updateOne:{filter:{tenantId:r.tenantId,source:r.source,recordId:r.id},update:{$set:{tenantId:r.tenantId,source:r.source,entity:r.entity,recordId:r.id,fields:r.fields,syncedAt:new Date()}},upsert:true}}))),
    AliasModel.bulkWrite(aliases.map(a=>({updateOne:{filter:{tenantId:a.tenantId,type:a.type,canonical:a.canonical},update:{$set:{...a,source:'seeded'}},upsert:true}})))
  ]);await hydrateRepository();return{tenants:await TenantModel.countDocuments(),records:await BusinessRecordModel.countDocuments(),aliases:await AliasModel.countDocuments()};
}
export async function hydrateRepository(){const[dbTenants,dbRecords,dbAliases]=await Promise.all([TenantModel.find().lean(),BusinessRecordModel.find().lean(),AliasModel.find().lean()]);repository.hydrate({tenants:dbTenants.map(t=>({id:t.tenantId,name:t.name,industry:t.industry,connectors:t.connectors.map(c=>({...c,lastSync:c.lastSync?.toISOString?.()||c.lastSync}))})),records:dbRecords.map(r=>({tenantId:r.tenantId,source:r.source,entity:r.entity,id:r.recordId,fields:r.fields})),aliases:dbAliases.map(a=>({tenantId:a.tenantId,type:a.type,canonical:a.canonical,variants:a.variants,uncertain:a.uncertain}))});}
export async function disconnectDatabase(){if(mongoose.connection.readyState)await mongoose.disconnect();}
