/*
 * 中文导读：把页面的数据归属筛选转换为当前账号获准访问的员工范围。
 */
import { ForbiddenError } from '../../common/errors/forbidden.js';
// The actor is always the authenticated user. A filter never replaces that identity.
export function requestedDataOwner(actorId:string,canViewWorkspaceData:boolean,requested='mine'):string|undefined {
 if(requested==='mine'||requested===actorId)return actorId;
 if(!canViewWorkspaceData)throw new ForbiddenError('普通用户只能查看本人及明确分配的数据。');
 return requested==='all'?undefined:requested;
}
