import mongoose from 'mongoose';
const schema = new mongoose.Schema({tenantId:{type:String,required:true,index:true},source:{type:String,required:true,index:true},entity:{type:String,required:true,index:true},recordId:{type:String,required:true},fields:{type:mongoose.Schema.Types.Mixed,required:true},syncedAt:{type:Date,default:Date.now}},{timestamps:true,versionKey:false});
schema.index({tenantId:1,source:1,entity:1}); schema.index({tenantId:1,source:1,recordId:1},{unique:true});
export const BusinessRecordModel = mongoose.models.BusinessRecord || mongoose.model('BusinessRecord',schema);
