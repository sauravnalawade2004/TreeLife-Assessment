import { repository } from '../repositories/demoRepository.js';
import { compileSemanticMap } from '../services/semantic/profiler.service.js';
import { answerService } from '../services/query/answer.service.js';
import { jiraConnector } from '../connectors/jira.connector.js';
import { pipedriveConnector } from '../connectors/pipedrive.connector.js';
import { syncPipedrive } from '../services/sync/pipedrive-sync.service.js';
import { databaseState } from '../database/database.js';
import { QueryAuditModel } from '../models/QueryAudit.js';
import { SemanticMapModel } from '../models/SemanticMap.js';
import { localDocumentsConnector } from '../connectors/local-documents.connector.js';
import { syncLocalDocuments } from '../services/sync/document-sync.service.js';
import { compileLiveSemanticLayer } from '../services/semantic/live-compiler.service.js';
import { liveAnswerService } from '../services/query/live-answer.service.js';
import { notionConnector } from '../connectors/notion.connector.js';
import { syncNotion } from '../services/sync/notion-sync.service.js';
import { googleDriveConnector } from '../connectors/google-drive.connector.js';
import { syncGoogleDrive } from '../services/sync/google-drive-sync.service.js';
import { assertSourceEnabled } from '../config/sources.js';

const demoFallbackEnabled = process.env.ALLOW_DEMO_FALLBACK === 'true';

export const apiController = {
  health: (_req,res) => res.json({status:'ok',service:'SemanticLens API',database:{mode:databaseState.mode,connected:databaseState.connected,name:databaseState.database},time:new Date().toISOString()}),
  tenants: (_req,res) => res.json({data:repository.listTenants()}),
  semanticMap: async (req,res,next) => { try { const stored=databaseState.connected?await SemanticMapModel.findOne({tenantId:req.params.tenantId}).lean():null; if(stored) return res.json({data:stored}); if(demoFallbackEnabled) return res.json({data:compileSemanticMap(req.params.tenantId,repository.findRecords(req.params.tenantId))}); throw Object.assign(new Error('Live semantic map is unavailable. Sync sources and compile the tenant first.'),{status:503}); } catch(e){next(e);} },
  ask: async (req,res,next) => { try { const {tenantId='acme-law',question} = req.body; if (!question?.trim()) return res.status(400).json({error:'question is required'}); const liveAvailable=databaseState.connected&&await liveAnswerService.available(tenantId); if(!liveAvailable&&!demoFallbackEnabled) throw Object.assign(new Error('Live evidence layer is unavailable; no answer was generated.'),{status:503}); const data=liveAvailable?await liveAnswerService.answer(tenantId,question):await answerService.answer(tenantId,question); if(databaseState.connected) QueryAuditModel.create({tenantId,question,status:data.status,interpretation:data.interpretation,answer:data.answer,confidence:data.confidence,matchedRecordIds:data.evidence?.matchedRecordIds||[],sourceCoverage:data.evidence?.sourceCoverage||[],ai:data.ai}).catch(e=>console.error('Audit write failed:',e.message)); res.json({data}); } catch(e){next(e);} },
  jiraHealth: async (_req,res,next) => { try {res.json({data:await jiraConnector.testConnection()});} catch(e){next(e);} },
  pipedriveHealth: async (_req,res,next) => { try {res.json({data:await pipedriveConnector.testConnection()});} catch(e){next(e);} },
  pipedriveSync: async (req,res,next) => { try {res.json({data:await syncPipedrive(req.body?.tenantId || 'acme-law', req.body || {})});} catch(e){next(e);} },
  documentsHealth: async (_req,res,next) => { try {assertSourceEnabled('documents'); res.json({data:await localDocumentsConnector.testConnection()});} catch(e){next(e);} },
  documentsSync: async (req,res,next) => { try {assertSourceEnabled('documents'); res.json({data:await syncLocalDocuments(req.body?.tenantId || 'acme-law')});} catch(e){next(e);} },
  notionHealth: async (_req,res,next) => { try {assertSourceEnabled('notion'); res.json({data:await notionConnector.testConnection()});} catch(e){next(e);} },
  notionSync: async (req,res,next) => { try {assertSourceEnabled('notion'); res.json({data:await syncNotion(req.body?.tenantId || 'acme-law')});} catch(e){next(e);} },
  googleDriveHealth: async (_req,res,next) => { try {assertSourceEnabled('google_drive'); res.json({data:await googleDriveConnector.testConnection()});} catch(e){next(e);} },
  googleDriveSync: async (req,res,next) => { try {assertSourceEnabled('google_drive'); res.json({data:await syncGoogleDrive(req.body?.tenantId || 'acme-law')});} catch(e){next(e);} },
  compileSemantic: async (req,res,next) => { try {res.json({data:await compileLiveSemanticLayer(req.body?.tenantId || 'acme-law')});} catch(e){next(e);} }
};
