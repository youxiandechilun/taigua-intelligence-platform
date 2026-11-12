/*
 * 中文导读：线路与语音外呼：dial-policy.ts。相关类型、配置或辅助实现集中在本文件。
 */
export function inDialWindow(policy: {days:string[];start:string;end:string;timeRestricted?:boolean}, now: Date) {
  if (policy.timeRestricted === false) return true;
  const china = new Date(now.getTime() + 8 * 3600000);
  const weekdays = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const clock = china.toISOString().slice(11,16);
  return policy.days.includes(weekdays[china.getUTCDay()]!) && clock >= policy.start && clock < policy.end;
}
export function holidayStatus(policy: {holidayRestricted:boolean}, now: Date) {
  if (!policy.holidayRestricted) return {allowed:true,calendarReady:true,message:''};
  try {
    const calendar=JSON.parse(process.env.SIP_HOLIDAY_CALENDAR||'{}') as Record<string,string[]>;
    const day=new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
    const dates=calendar[day.slice(0,4)];
    if (!Array.isArray(dates)||dates.some(v=>typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))) return {allowed:false,calendarReady:false,message:'当前年度节假日安排尚未设置'};
    const allowed=!dates.includes(day);
    return {allowed,calendarReady:true,message:allowed?'':'今天为暂停拨打的节假日'};
  } catch { return {allowed:false,calendarReady:false,message:'当前年度节假日安排尚未设置'}; }
}

export function holidayAllowed(policy: {holidayRestricted:boolean}, now: Date) {return holidayStatus(policy,now).allowed;}
