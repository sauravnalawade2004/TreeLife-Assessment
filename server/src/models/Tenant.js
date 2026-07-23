import mongoose from 'mongoose';
const connectorSchema = new mongoose.Schema({id:String,type:String,name:String,status:String,lastSync:Date,recordCount:Number,config:{type:mongoose.Schema.Types.Mixed,default:{}}},{_id:false});
const schema = new mongoose.Schema({tenantId:{type:String,required:true,unique:true,index:true},name:{type:String,required:true},industry:String,connectors:[connectorSchema]},{timestamps:true,versionKey:false});
export const TenantModel = mongoose.models.Tenant || mongoose.model('Tenant',schema);
