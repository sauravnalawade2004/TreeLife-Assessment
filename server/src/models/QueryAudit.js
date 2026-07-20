import mongoose from 'mongoose';
const schema = new mongoose.Schema({tenantId:{type:String,required:true,index:true},question:{type:String,required:true},status:String,interpretation:mongoose.Schema.Types.Mixed,answer:mongoose.Schema.Types.Mixed,confidence:Number,matchedRecordIds:[String],sourceCoverage:mongoose.Schema.Types.Mixed,ai:mongoose.Schema.Types.Mixed},{timestamps:true,versionKey:false});
schema.index({tenantId:1,createdAt:-1});
export const QueryAuditModel = mongoose.models.QueryAudit || mongoose.model('QueryAudit',schema);
