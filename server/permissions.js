import { forbidden, badRequest } from './http.js';

export const MODE_PERMISSION = { view: 'device:view', control: 'device:control', terminal: 'device:terminal' };

const catalogue = (db) => db.prepare('SELECT key FROM permissions ORDER BY rowid').all().map(r => r.key);
const membership = (db, orgId, userId) => db.prepare('SELECT role,status FROM memberships WHERE org_id=? AND user_id=?').get(orgId,userId);
const expand = (pattern, keys) => pattern === '*' ? keys : pattern.endsWith(':*') ? keys.filter(k => k.startsWith(pattern.slice(0,-1))) : (keys.includes(pattern) ? [pattern] : []);
const applicable = (db,{userId,orgId,deviceId,at}) => {
  let sql=`SELECT g.id grant_id,g.device_id,g.effect,gp.permission FROM grants g JOIN grant_permissions gp ON gp.grant_id=g.id WHERE g.user_id=? AND g.org_id=? AND g.revoked_at IS NULL AND (g.starts_at IS NULL OR g.starts_at<=?) AND (g.expires_at IS NULL OR g.expires_at>?)`;
  const args=[userId,orgId,at,at];
  if(deviceId!==null){sql+=' AND (g.device_id IS NULL OR g.device_id=?)';args.push(deviceId);}
  return db.prepare(sql).all(...args);
};
const denySet=(keys,role,reason)=>({role,permissions:Object.fromEntries(keys.map(k=>[k,{effect:'deny',source:null,reason}]))});
function evaluate(keys, role, base, grants){
  const denied=new Map(), allowed=new Map();
  for(const g of grants) if(g.effect==='deny') for(const k of expand(g.permission,keys)) if(!denied.has(k)) denied.set(k,g.grant_id);
  for(const k of base) allowed.set(k,`role:${role}`);
  for(const g of grants) if(g.effect==='allow') for(const k of expand(g.permission,keys)) if(!allowed.has(k)) allowed.set(k,`grant:${g.grant_id}`);
  return Object.fromEntries(keys.map(k=>denied.has(k)?[k,{effect:'deny',source:`grant:${denied.get(k)}`,reason:'explicit_deny'}]:allowed.has(k)?[k,{effect:'allow',source:allowed.get(k),reason:null}]:[k,{effect:'deny',source:null,reason:'implicit'}]));
}
export function resolve(db,{userId,orgId,deviceId=null,now=new Date()}){
  const keys=catalogue(db), m=membership(db,orgId,userId);
  if(!m) return denySet(keys,null,'not_a_member');
  if(m.status==='suspended') return denySet(keys,m.role,'suspended');
  if(m.status!=='active') return denySet(keys,m.role,'inactive_membership');
  const base=db.prepare('SELECT permission FROM role_permissions WHERE role=?').all(m.role).map(r=>r.permission);
  return {role:m.role,permissions:evaluate(keys,m.role,base,applicable(db,{userId,orgId,deviceId,at:now.toISOString()}))};
}
export function resolveDevices(db,{userId,orgId,deviceIds,now=new Date()}){
  const keys=catalogue(db),m=membership(db,orgId,userId);
  if(!m || m.status!=='active') { const p=denySet(keys,m?.role??null,!m?'not_a_member':m.status==='suspended'?'suspended':'inactive_membership').permissions; return {role:m?.role??null,byDevice:Object.fromEntries(deviceIds.map(id=>[id,p]))}; }
  const base=db.prepare('SELECT permission FROM role_permissions WHERE role=?').all(m.role).map(r=>r.permission);
  const all=applicable(db,{userId,orgId,deviceId:null,at:now.toISOString()});
  return {role:m.role,byDevice:Object.fromEntries(deviceIds.map(id=>[id,evaluate(keys,m.role,base,all.filter(g=>g.device_id===null||g.device_id===id))]))};
}
export function can(db,ctx,permission,deviceId=null){ return resolve(db,{userId:ctx.userId,orgId:ctx.orgId,deviceId}).permissions[permission]?.effect==='allow'; }
export function assertCan(db,ctx,permission,deviceId=null){ const r=resolve(db,{userId:ctx.userId,orgId:ctx.orgId,deviceId}); const hit=r.permissions[permission]; if(hit?.effect==='allow') return; if(hit?.reason==='suspended') throw forbidden('membership is suspended','suspended'); throw forbidden(`missing permission: ${permission}`,'missing_permission'); }
export function assertMayGrant(db,ctx,patterns,deviceId=null){
  if(patterns.length===0) throw badRequest('permissions must not be empty');
  if(ctx.userId===ctx.targetUserId) throw forbidden('cannot grant to yourself');
  for(const pattern of patterns){
    const keys=catalogue(db), needed=expand(pattern,keys);
    if(needed.length===0) throw badRequest(`unknown permission: ${pattern}`,'unknown_permission');
    for(const k of needed) if(!can(db,ctx,k,deviceId)) throw forbidden(`cannot grant permission you do not hold: ${k}`,'grant_not_held');
  }
}
export function assertCanStartSession(db,ctx,mode,deviceId){
  if(!can(db,ctx,'session:start')) throw forbidden('missing session:start','missing_permission');
  if(!can(db,ctx,MODE_PERMISSION[mode],deviceId)) throw forbidden(`missing ${MODE_PERMISSION[mode]}`,'missing_device_permission');
}
