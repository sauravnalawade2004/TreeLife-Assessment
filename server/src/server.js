import './load-env.js';
import { app } from './app.js';
import { connectDatabase } from './database/database.js';
// Environment-backed connectors are reloaded whenever the development server restarts.
const port = Number(process.env.PORT || 4000);
const state=await connectDatabase();
app.listen(port,()=>console.log(`SemanticLens API listening on http://localhost:${port} · data=${state.mode}${state.error ? ` · ${state.error}` : ''}`));
