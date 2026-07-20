import 'dotenv/config';
import {connectDatabase,seedDatabase,disconnectDatabase} from './database.js';
try{const state=await connectDatabase({seedIfEmpty:false});if(!state.connected)throw new Error(state.error||'MONGODB_URI is not configured');const counts=await seedDatabase({replace:true});console.log(`Seeded Atlas: ${counts.tenants} tenants, ${counts.records} records, ${counts.aliases} aliases.`);}finally{await disconnectDatabase();}
