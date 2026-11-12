/*
 * 中文导读：客户管理：crm.route.ts。声明接口路径、中间件和处理函数。
 */
import authMiddleware from '../../middleware/auth.middleware.js';
import {requirePermission} from '../../middleware/authorize.middleware.js';
import {trustedOrigins} from '../../config/origins.js';
import {crmDb} from './crm.db.js';
import {createCrmRouter} from './crm.http.js';
export default createCrmRouter(crmDb,[authMiddleware,requirePermission({crm:['read']})],trustedOrigins);
