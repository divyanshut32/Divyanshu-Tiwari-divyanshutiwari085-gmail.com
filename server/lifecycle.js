import { newId, nowIso } from './db.js';
import { forbidden, conflict, lastOwner } from './http.js';

export function roleRanks(db){ return Object.fromEntries(db.prepare('SELECT key,rank FROM roles').all().map(r=>[r.key,r.rank])); }
export function assertRoleExists(db,role){ if(!db.prepare('SELECT 1 FROM roles WHERE key=?').get(role)) throw forbidden('unknown role','unknown_role'); }
export function assertCanModify(db,callerRole,targetRole){
  const ranks=roleRanks(db); if(ranks[callerRole]===undefined||ranks[targetRole]===undefined||ranks[callerRole] < ranks[targetRole]) throw forbidden('insufficient role authority','forbidden');
}
export function assertNotLastOwner(db,orgId,userId){ const n=db.prepare("SELECT count(*) n FROM memberships WHERE org_id=? AND role='owner' AND status='active'").get(orgId).n; if(n<=1){ const own=db.prepare("SELECT 1 FROM memberships WHERE org_id=? AND user_id=? AND role='owner' AND status='active'").get(orgId,userId); if(own) throw lastOwner(); } }
export function endActiveSessions(db,{orgId,userId,deviceId,reason,exceptSessionId}){
  const where=['org_id=?','state=\'active\''], args=[orgId];
  if(userId){where.push('user_id=?');args.push(userId);} if(deviceId){where.push('device_id=?');args.push(deviceId);} if(exceptSessionId){where.push('id<>?');args.push(exceptSessionId);}
  db.prepare(`UPDATE sessions SET state='ended',ended_at=?,end_reason=? WHERE ${where.join(' AND ')}`).run(nowIso(),reason,...args);
}
export function snapshotAuthority(db,{userId,orgId,deviceId}){ const m=db.prepare('SELECT role FROM memberships WHERE org_id=? AND user_id=?').get(orgId,userId); const grants=db.prepare("SELECT DISTINCT g.id FROM grants g JOIN grant_permissions gp ON gp.grant_id=g.id WHERE g.org_id=? AND g.user_id=? AND g.revoked_at IS NULL AND (g.device_id IS NULL OR g.device_id=?)").all(orgId,userId,deviceId).map(r=>r.id); return JSON.stringify({role:m?.role??null,grantIds:grants,snapshotAt:nowIso()}); }
export function sessionExpiry(db,orgId){ const o=db.prepare('SELECT max_session_minutes FROM organizations WHERE id=?').get(orgId); return new Date(Date.now()+(o?.max_session_minutes??60)*60000).toISOString(); }
