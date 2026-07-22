import dns from 'dns';
import { URL } from 'node:url';
dns.setServers(["8.8.8.8", "1.1.1.1"]);

import '../load-env.js';
import mongoose from 'mongoose';
import {tenants,records,aliases} from '../data/tenants.js';
import {TenantModel} from '../models/Tenant.js';
import {BusinessRecordModel} from '../models/BusinessRecord.js';
import {AliasModel} from '../models/Alias.js';
import {repository} from '../repositories/demoRepository.js';

function buildFallbackUri(uri, srvRecords) {
  const parsed = new URL(uri);
  parsed.protocol = 'mongodb:';
  parsed.hostname = '';
  parsed.port = '';
  const hosts = srvRecords.map((record) => `${record.name}:${record.port}`).join(',');
  const params = new URLSearchParams(parsed.searchParams);
  if (!params.has('tls') && !params.has('ssl')) params.set('tls', 'true');
  parsed.search = params.toString();
  return `mongodb://${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@${hosts}${parsed.pathname}${parsed.search ? `?${parsed.search}` : ''}`;
}

async function resolveSrvHosts(uri) {
  const host = new URL(uri).hostname;
  return dns.promises.resolveSrv(`_mongodb._tcp.${host}`);
}

async function connectWithFallback(uri, options = {}) {
  try {
    return await mongoose.connect(uri, options);
  } catch (error) {
    if (uri.startsWith('mongodb+srv://') && error.message.includes('querySrv')) {
      try {
        const srvRecords = await resolveSrvHosts(uri);
        const fallbackUri = buildFallbackUri(uri, srvRecords);
        console.error('MongoDB SRV failed, retrying with explicit hosts:', fallbackUri);
        return await mongoose.connect(fallbackUri, options);
      } catch (fallbackError) {
        fallbackError.message = `MongoDB SRV fallback failed: ${fallbackError.message}`;
        throw fallbackError;
      }
    }
    throw error;
  }
}

export const databaseState={mode:'memory',connected:false,database:null,error:null};
export async function connectDatabase({seedIfEmpty=true}={}){
  if(!process.env.MONGODB_URI) return databaseState;
  try{
    await connectWithFallback(process.env.MONGODB_URI,{serverSelectionTimeoutMS:12000});
    databaseState.mode='atlas';
    databaseState.connected=true;
    databaseState.database=mongoose.connection.name;
    databaseState.error=null;
    if(seedIfEmpty&&await TenantModel.estimatedDocumentCount()===0)await seedDatabase({replace:false});
    await hydrateRepository();
    return databaseState;
  }
  catch(error){
    databaseState.mode='memory-fallback';
    databaseState.connected=false;
    databaseState.database=null;
    databaseState.error=error?.message || 'Unknown MongoDB connection error';
    console.error('Atlas unavailable; using safe in-memory fallback:', databaseState.error);
    return databaseState;
  }
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
