import mongoose from 'mongoose';
const schema = new mongoose.Schema({tenantId:{type:String,required:true,index:true},type:{type:String,required:true},canonical:{type:String,required:true},variants:[String],uncertain:[String],source:{type:String,default:'discovered'},confidence:{type:Number,default:.9}},{timestamps:true,versionKey:false});
schema.index({tenantId:1,type:1,canonical:1},{unique:true});
export const AliasModel = mongoose.models.Alias || mongoose.model('Alias',schema);
