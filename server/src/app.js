import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import routes from './routes/api.routes.js';
export const app = express();
app.use(cors({origin:process.env.CLIENT_ORIGIN || 'http://localhost:5173'}));
app.use(express.json({limit:'100kb'}));
app.use('/api',routes);
app.use((err,_req,res,_next)=>res.status(err.status||500).json({error:err.message||'Internal server error'}));
