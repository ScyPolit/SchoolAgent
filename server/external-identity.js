// Future identity-provider integration boundary; intentionally no OAuth endpoint.
// Call only after the provider identity has been verified by a trusted server flow.
import {get,run,id,now,transaction} from './db.js';
import {HttpError,audit} from './security.js';
function validate(provider,subject){if(typeof provider!=='string'||!provider||provider.length>80||typeof subject!=='string'||!subject||subject.length>500)throw new HttpError(400,'外部身份标识无效','INVALID_EXTERNAL_IDENTITY');}
export function resolveExternalIdentity(provider,subject){validate(provider,subject);return get('SELECT u.id,u.active FROM external_identities e JOIN users u ON e.user_id=u.id WHERE e.provider=? AND e.subject=?',provider,subject)||null;}
export function bindVerifiedExternalIdentity({request,userId,provider,subject}){
 validate(provider,subject);
 // No browser-facing shortcut can bind an arbitrary provider subject.
 if(request?.user?.role!=='superadmin')throw new HttpError(403,'外部身份绑定仅供经授权的服务端集成使用','IDENTITY_BINDING_FORBIDDEN');
 if(!get('SELECT id FROM users WHERE id=?',userId))throw new HttpError(404,'本地账号不存在');
 const existing=get('SELECT * FROM external_identities WHERE provider=? AND subject=?',provider,subject);
 if(existing&&existing.user_id!==userId)throw new HttpError(409,'外部身份已绑定其他账号','IDENTITY_CONFLICT');
 if(!existing){run('INSERT INTO external_identities(id,user_id,provider,subject) VALUES(?,?,?,?)',id('ext_'),userId,provider,subject);audit(request,'identity.bound',userId,{outcome:'created'});}
 return {userId,provider};
}
