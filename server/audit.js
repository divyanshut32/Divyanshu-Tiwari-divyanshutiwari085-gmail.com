import { newId, nowIso } from './db.js';
import { HttpError } from './http.js';
export function audit(db,{orgId,actorId,action,targetType,targetId,result,reasonCode,requestId}){
  db.prepare(`INSERT INTO audit_events (id,org_id,actor_id,action,target_type,target_id,result,reason_code,request_id,at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(newId('aud'),orgId,actorId??null,action,targetType??null,targetId??null,result,reasonCode??null,requestId??null,nowIso());
}
export function auditDenials(db,ctx,meta,fn){ try{return fn();}catch(err){if(err instanceof HttpError && err.status===403){audit(db,{orgId:ctx.orgId,actorId:ctx.userId,...meta,result:'deny',reasonCode:err.reason??err.code,requestId:ctx.requestId});}throw err;}}
