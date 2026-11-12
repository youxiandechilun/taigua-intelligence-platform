/*
 * 中文导读：共享基础能力：navigation.ts。相关类型、配置或辅助实现集中在本文件。
 */
export const navigationDefaults=[
 {id:'dashboard',label:'仪表盘',href:'/dashboard'},
 {id:'agents',label:'数字员工',href:'/agents'},
 {id:'outbound',label:'外呼',href:'/outbound'},
 {id:'calls',label:'通话记录',href:'/calls'},
 {id:'kb',label:'知识库',href:'/kb'},
 {id:'crm',label:'客户库',href:'/crm'},
 {id:'wecom',label:'企业微信',href:'/wecom'},
 {id:'tools',label:'业务工具',href:'/tools'},
 {id:'automation',label:'自动化',href:'/automation'},
 {id:'settings',label:'设置中心',href:'/settings'},
] as const;
export type NavigationId=typeof navigationDefaults[number]['id'];
export type NavigationItem={id:NavigationId;label:string;enabled:boolean};
export type NavigationPolicy={items:NavigationItem[];revision:number};
export const defaultNavigationPolicy=():NavigationPolicy=>({items:navigationDefaults.map(({id,label})=>({id,label,enabled:true})),revision:0});
// Keep the existing workspace feature switch and saved menu policy compatible.
export function navigationArea(path:string){if(path==='/voices'||path.startsWith('/voices/')||path==='/recognition'||path.startsWith('/recognition/'))return 'settings';return navigationDefaults.find(item=>path===item.href||path.startsWith(item.href+'/'))?.id;}
