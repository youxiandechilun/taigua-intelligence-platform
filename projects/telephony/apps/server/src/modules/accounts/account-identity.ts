/*
 * 中文导读：员工账号：account-identity.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {z} from 'zod';
export const normalizeAccount=(v:string)=>v.normalize('NFKC').trim().toLowerCase();
export const accountNameSchema=z.string().transform(normalizeAccount).pipe(z.string().regex(/^[\p{Script=Han}a-z0-9_-]{1,40}$/u,'账号限中文、字母、数字、下划线或短横线，最多40字').refine(v=>/\p{Script=Han}/u.test(v)||v.length>=3,'字母或数字账号至少3位'));
// Keep the authentication provider's email contract ASCII; only the displayed alias is Chinese.
export function accountEmail(v:string,domain:string){const n=normalizeAccount(v);return (/\p{Script=Han}/u.test(n)?'cn-'+Buffer.from(n,'utf8').toString('hex'):n)+'@'+domain;}
export function accountUsername(email:string,domain:string){if(!email.endsWith('@'+domain))return email;const n=email.slice(0,-domain.length-1);if(/^cn-(?:[a-f0-9]{2})+$/i.test(n)){const decoded=Buffer.from(n.slice(3),'hex').toString('utf8');if(accountNameSchema.safeParse(decoded).success&&accountEmail(decoded,domain)===email)return decoded;}return n;}
