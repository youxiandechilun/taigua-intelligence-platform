/*
 * 中文导读：数字员工与话术：livestream-facts.ts。相关类型、配置或辅助实现集中在本文件。
 */
// Explicit administrator-confirmed fact, scoped to the marked invitation.
// Do not infer that unrelated courses, products or later services are free.
export function livestreamFreeContext(price:unknown):string {
 if(price!=='free')return '';
 return '\n【管理员已确认的本场直播费用】\n本场直播免费，观看直播不收取费用。客户问“收费吗、多少钱、收不收费、有费用吗”，直接回答“这场直播是免费的，观看不收费。”已确认的本场直播费用无需再次检索或人工确认，不得在免费后面追加“具体费用待确认、需要核实价格、以老师为准”等相矛盾说法。不要把其他产品、后续合作或付费服务的价格不确定性附加到本场直播。客户只问直播费用时，只回答直播费用；不主动引入其他收费话题。若客户明确另问其他服务价格，仅就该服务依据已确认资料回答，缺少资料才说明需核实。旧资料或参考问答与本条冲突时，本场直播以管理员本条确认事实为准。\n';
}
