/*
 * 中文导读：线路与语音外呼：realtime-voices.ts。相关类型、配置或辅助实现集中在本文件。
 */
// Official voice IDs are model-specific. Keep spaces and Unicode unchanged.
// https://help.aliyun.com/zh/model-studio/omni-voice-list
// https://platform.qianwenai.com/docs/developer-guides/speech/qwen-audio-realtime
export type RealtimeBuiltinVoice = { id: string; name: string; gender: 'female' | 'male' | 'neutral' };
export const realtimeBuiltinVoices: Record<string, readonly RealtimeBuiltinVoice[]> = {
  "qwen3.8-omni-flash-realtime": [
    {
      "id": "Tina",
      "name": "甜甜",
      "gender": "neutral"
    },
    {
      "id": "Cindy",
      "name": "林欣宜",
      "gender": "female"
    },
    {
      "id": "Liora Mira",
      "name": "清欢",
      "gender": "neutral"
    },
    {
      "id": "Raymond",
      "name": "林川野",
      "gender": "male"
    },
    {
      "id": "Zane",
      "name": "泽恩",
      "gender": "neutral"
    },
    {
      "id": "Katerina",
      "name": "卡捷琳娜",
      "gender": "female"
    },
    {
      "id": "Ryan",
      "name": "甜茶",
      "gender": "neutral"
    },
    {
      "id": "Mia",
      "name": "温柔生活博主-舒然",
      "gender": "neutral"
    },
    {
      "id": "Cici",
      "name": "绵绵",
      "gender": "female"
    },
    {
      "id": "Theo Calm",
      "name": "予安",
      "gender": "neutral"
    },
    {
      "id": "Serena",
      "name": "苏瑶",
      "gender": "female"
    },
    {
      "id": "Maia",
      "name": "四月",
      "gender": "neutral"
    },
    {
      "id": "Evan",
      "name": "江晨",
      "gender": "male"
    },
    {
      "id": "Qiao",
      "name": "小乔妹",
      "gender": "neutral"
    },
    {
      "id": "Momo",
      "name": "茉兔",
      "gender": "neutral"
    },
    {
      "id": "Wil",
      "name": "伟伦",
      "gender": "male"
    },
    {
      "id": "Angel",
      "name": "台普-安琪",
      "gender": "neutral"
    },
    {
      "id": "Li Cassian",
      "name": "东厂-李公公",
      "gender": "neutral"
    },
    {
      "id": "Joyner",
      "name": "喜剧担当-阿逗",
      "gender": "neutral"
    },
    {
      "id": "Gold",
      "name": "金爷",
      "gender": "neutral"
    },
    {
      "id": "Jennifer",
      "name": "詹妮弗",
      "gender": "female"
    },
    {
      "id": "Aiden",
      "name": "艾登",
      "gender": "male"
    },
    {
      "id": "Mione",
      "name": "敏儿",
      "gender": "female"
    },
    {
      "id": "Sunny",
      "name": "四川-晴儿",
      "gender": "female"
    },
    {
      "id": "Dylan",
      "name": "北京-晓东",
      "gender": "male"
    },
    {
      "id": "Eric",
      "name": "四川-程川",
      "gender": "male"
    },
    {
      "id": "Peter",
      "name": "天津-李彼得",
      "gender": "neutral"
    },
    {
      "id": "Joseph Chen",
      "name": "阿樸伯",
      "gender": "neutral"
    },
    {
      "id": "Marcus",
      "name": "陕西-秦川",
      "gender": "neutral"
    },
    {
      "id": "Li",
      "name": "南京-老李",
      "gender": "male"
    },
    {
      "id": "Rocky",
      "name": "粤语-阿强",
      "gender": "neutral"
    },
    {
      "id": "Kiki",
      "name": "粤语-阿清",
      "gender": "female"
    },
    {
      "id": "Sohee",
      "name": "素熙",
      "gender": "female"
    },
    {
      "id": "Eliška",
      "name": "艾莉卡",
      "gender": "neutral"
    },
    {
      "id": "Alek",
      "name": "阿列克",
      "gender": "neutral"
    },
    {
      "id": "Arda",
      "name": "阿尔达",
      "gender": "neutral"
    },
    {
      "id": "Dolce",
      "name": "多尔切",
      "gender": "male"
    },
    {
      "id": "Lenn",
      "name": "莱恩",
      "gender": "neutral"
    },
    {
      "id": "Ono Anna",
      "name": "小野杏",
      "gender": "neutral"
    },
    {
      "id": "Sonrisa",
      "name": "索尼莎",
      "gender": "female"
    },
    {
      "id": "Bodega",
      "name": "博德加",
      "gender": "male"
    },
    {
      "id": "Andre",
      "name": "安德雷",
      "gender": "male"
    },
    {
      "id": "Radio Gol",
      "name": "拉迪奥·戈尔",
      "gender": "neutral"
    },
    {
      "id": "Rizky",
      "name": "阿力",
      "gender": "male"
    },
    {
      "id": "Roya",
      "name": "萝雅",
      "gender": "female"
    },
    {
      "id": "Hana",
      "name": "阿幸",
      "gender": "female"
    },
    {
      "id": "Jakub",
      "name": "雅克",
      "gender": "neutral"
    },
    {
      "id": "Griet",
      "name": "海娜（荷兰）",
      "gender": "female"
    },
    {
      "id": "Marina",
      "name": "玛丽娜",
      "gender": "female"
    },
    {
      "id": "Siiri",
      "name": "西芮",
      "gender": "neutral"
    },
    {
      "id": "Ingrid",
      "name": "林恩",
      "gender": "female"
    },
    {
      "id": "Sigga",
      "name": "海娜（冰岛）",
      "gender": "female"
    },
    {
      "id": "Bea",
      "name": "雅娜",
      "gender": "female"
    },
    {
      "id": "Chloe",
      "name": "思怡",
      "gender": "female"
    },
    {
      "id": "Emilien",
      "name": "埃米尔安",
      "gender": "male"
    },
    {
      "id": "longanlingxin",
      "name": "龙安灵心",
      "gender": "neutral"
    }
  ],
  "qwen3.5-omni-flash-realtime": [
    {
      "id": "Tina",
      "name": "甜甜",
      "gender": "neutral"
    },
    {
      "id": "Cindy",
      "name": "林欣宜",
      "gender": "female"
    },
    {
      "id": "Liora Mira",
      "name": "清欢",
      "gender": "neutral"
    },
    {
      "id": "Raymond",
      "name": "林川野",
      "gender": "male"
    },
    {
      "id": "Katerina",
      "name": "卡捷琳娜",
      "gender": "female"
    },
    {
      "id": "Ryan",
      "name": "甜茶",
      "gender": "neutral"
    },
    {
      "id": "Mia",
      "name": "温柔生活博主-舒然",
      "gender": "neutral"
    },
    {
      "id": "Theo Calm",
      "name": "予安",
      "gender": "neutral"
    },
    {
      "id": "Serena",
      "name": "苏瑶",
      "gender": "female"
    },
    {
      "id": "Maia",
      "name": "四月",
      "gender": "neutral"
    },
    {
      "id": "Evan",
      "name": "江晨",
      "gender": "male"
    },
    {
      "id": "Qiao",
      "name": "小乔妹",
      "gender": "neutral"
    },
    {
      "id": "Momo",
      "name": "茉兔",
      "gender": "neutral"
    },
    {
      "id": "Wil",
      "name": "伟伦",
      "gender": "male"
    },
    {
      "id": "Angel",
      "name": "台普-安琪",
      "gender": "neutral"
    },
    {
      "id": "Li Cassian",
      "name": "东厂-李公公",
      "gender": "neutral"
    },
    {
      "id": "Joyner",
      "name": "喜剧担当-阿逗",
      "gender": "neutral"
    },
    {
      "id": "Gold",
      "name": "金爷",
      "gender": "neutral"
    },
    {
      "id": "Jennifer",
      "name": "詹妮弗",
      "gender": "female"
    },
    {
      "id": "Aiden",
      "name": "艾登",
      "gender": "male"
    },
    {
      "id": "Mione",
      "name": "敏儿",
      "gender": "female"
    },
    {
      "id": "Sunny",
      "name": "四川-晴儿",
      "gender": "female"
    },
    {
      "id": "Dylan",
      "name": "北京-晓东",
      "gender": "male"
    },
    {
      "id": "Eric",
      "name": "四川-程川",
      "gender": "male"
    },
    {
      "id": "Peter",
      "name": "天津-李彼得",
      "gender": "neutral"
    },
    {
      "id": "Joseph Chen",
      "name": "阿樸伯",
      "gender": "neutral"
    },
    {
      "id": "Marcus",
      "name": "陕西-秦川",
      "gender": "neutral"
    },
    {
      "id": "Li",
      "name": "南京-老李",
      "gender": "male"
    },
    {
      "id": "Rocky",
      "name": "粤语-阿强",
      "gender": "neutral"
    },
    {
      "id": "Kiki",
      "name": "粤语-阿清",
      "gender": "female"
    },
    {
      "id": "Sohee",
      "name": "素熙",
      "gender": "female"
    },
    {
      "id": "Eliška",
      "name": "艾莉卡",
      "gender": "neutral"
    },
    {
      "id": "Alek",
      "name": "阿列克",
      "gender": "neutral"
    },
    {
      "id": "Arda",
      "name": "阿尔达",
      "gender": "neutral"
    },
    {
      "id": "Dolce",
      "name": "多尔切",
      "gender": "male"
    },
    {
      "id": "Lenn",
      "name": "莱恩",
      "gender": "neutral"
    },
    {
      "id": "Ono Anna",
      "name": "小野杏",
      "gender": "neutral"
    },
    {
      "id": "Sonrisa",
      "name": "索尼莎",
      "gender": "female"
    },
    {
      "id": "Bodega",
      "name": "博德加",
      "gender": "male"
    },
    {
      "id": "Andre",
      "name": "安德雷",
      "gender": "male"
    },
    {
      "id": "Radio Gol",
      "name": "拉迪奥·戈尔",
      "gender": "neutral"
    },
    {
      "id": "Rizky",
      "name": "阿力",
      "gender": "male"
    },
    {
      "id": "Roya",
      "name": "萝雅",
      "gender": "female"
    },
    {
      "id": "Hana",
      "name": "阿幸",
      "gender": "female"
    },
    {
      "id": "Jakub",
      "name": "雅克",
      "gender": "neutral"
    },
    {
      "id": "Griet",
      "name": "海娜（荷兰）",
      "gender": "female"
    },
    {
      "id": "Marina",
      "name": "玛丽娜",
      "gender": "female"
    },
    {
      "id": "Siiri",
      "name": "西芮",
      "gender": "neutral"
    },
    {
      "id": "Ingrid",
      "name": "林恩",
      "gender": "female"
    },
    {
      "id": "Sigga",
      "name": "海娜（冰岛）",
      "gender": "female"
    },
    {
      "id": "Bea",
      "name": "雅娜",
      "gender": "female"
    },
    {
      "id": "Chloe",
      "name": "思怡",
      "gender": "female"
    },
    {
      "id": "Emilien",
      "name": "埃米尔安",
      "gender": "male"
    },
    {
      "id": "Sunnybobi",
      "name": "知芝",
      "gender": "female"
    },
    {
      "id": "Ethan",
      "name": "晨煦",
      "gender": "neutral"
    },
    {
      "id": "Harvey",
      "name": "厚",
      "gender": "neutral"
    }
  ],
  "qwen3.5-omni-plus-realtime": [
    {
      "id": "Tina",
      "name": "甜甜",
      "gender": "neutral"
    },
    {
      "id": "Cindy",
      "name": "林欣宜",
      "gender": "female"
    },
    {
      "id": "Liora Mira",
      "name": "清欢",
      "gender": "neutral"
    },
    {
      "id": "Raymond",
      "name": "林川野",
      "gender": "male"
    },
    {
      "id": "Katerina",
      "name": "卡捷琳娜",
      "gender": "female"
    },
    {
      "id": "Ryan",
      "name": "甜茶",
      "gender": "neutral"
    },
    {
      "id": "Mia",
      "name": "温柔生活博主-舒然",
      "gender": "neutral"
    },
    {
      "id": "Theo Calm",
      "name": "予安",
      "gender": "neutral"
    },
    {
      "id": "Serena",
      "name": "苏瑶",
      "gender": "female"
    },
    {
      "id": "Maia",
      "name": "四月",
      "gender": "neutral"
    },
    {
      "id": "Evan",
      "name": "江晨",
      "gender": "male"
    },
    {
      "id": "Qiao",
      "name": "小乔妹",
      "gender": "neutral"
    },
    {
      "id": "Momo",
      "name": "茉兔",
      "gender": "neutral"
    },
    {
      "id": "Wil",
      "name": "伟伦",
      "gender": "male"
    },
    {
      "id": "Angel",
      "name": "台普-安琪",
      "gender": "neutral"
    },
    {
      "id": "Li Cassian",
      "name": "东厂-李公公",
      "gender": "neutral"
    },
    {
      "id": "Joyner",
      "name": "喜剧担当-阿逗",
      "gender": "neutral"
    },
    {
      "id": "Gold",
      "name": "金爷",
      "gender": "neutral"
    },
    {
      "id": "Jennifer",
      "name": "詹妮弗",
      "gender": "female"
    },
    {
      "id": "Aiden",
      "name": "艾登",
      "gender": "male"
    },
    {
      "id": "Mione",
      "name": "敏儿",
      "gender": "female"
    },
    {
      "id": "Sunny",
      "name": "四川-晴儿",
      "gender": "female"
    },
    {
      "id": "Dylan",
      "name": "北京-晓东",
      "gender": "male"
    },
    {
      "id": "Eric",
      "name": "四川-程川",
      "gender": "male"
    },
    {
      "id": "Peter",
      "name": "天津-李彼得",
      "gender": "neutral"
    },
    {
      "id": "Joseph Chen",
      "name": "阿樸伯",
      "gender": "neutral"
    },
    {
      "id": "Marcus",
      "name": "陕西-秦川",
      "gender": "neutral"
    },
    {
      "id": "Li",
      "name": "南京-老李",
      "gender": "male"
    },
    {
      "id": "Rocky",
      "name": "粤语-阿强",
      "gender": "neutral"
    },
    {
      "id": "Kiki",
      "name": "粤语-阿清",
      "gender": "female"
    },
    {
      "id": "Sohee",
      "name": "素熙",
      "gender": "female"
    },
    {
      "id": "Eliška",
      "name": "艾莉卡",
      "gender": "neutral"
    },
    {
      "id": "Alek",
      "name": "阿列克",
      "gender": "neutral"
    },
    {
      "id": "Arda",
      "name": "阿尔达",
      "gender": "neutral"
    },
    {
      "id": "Dolce",
      "name": "多尔切",
      "gender": "male"
    },
    {
      "id": "Lenn",
      "name": "莱恩",
      "gender": "neutral"
    },
    {
      "id": "Ono Anna",
      "name": "小野杏",
      "gender": "neutral"
    },
    {
      "id": "Sonrisa",
      "name": "索尼莎",
      "gender": "female"
    },
    {
      "id": "Bodega",
      "name": "博德加",
      "gender": "male"
    },
    {
      "id": "Andre",
      "name": "安德雷",
      "gender": "male"
    },
    {
      "id": "Radio Gol",
      "name": "拉迪奥·戈尔",
      "gender": "neutral"
    },
    {
      "id": "Rizky",
      "name": "阿力",
      "gender": "male"
    },
    {
      "id": "Roya",
      "name": "萝雅",
      "gender": "female"
    },
    {
      "id": "Hana",
      "name": "阿幸",
      "gender": "female"
    },
    {
      "id": "Jakub",
      "name": "雅克",
      "gender": "neutral"
    },
    {
      "id": "Griet",
      "name": "海娜（荷兰）",
      "gender": "female"
    },
    {
      "id": "Marina",
      "name": "玛丽娜",
      "gender": "female"
    },
    {
      "id": "Siiri",
      "name": "西芮",
      "gender": "neutral"
    },
    {
      "id": "Ingrid",
      "name": "林恩",
      "gender": "female"
    },
    {
      "id": "Sigga",
      "name": "海娜（冰岛）",
      "gender": "female"
    },
    {
      "id": "Bea",
      "name": "雅娜",
      "gender": "female"
    },
    {
      "id": "Chloe",
      "name": "思怡",
      "gender": "female"
    },
    {
      "id": "Emilien",
      "name": "埃米尔安",
      "gender": "male"
    },
    {
      "id": "Sunnybobi",
      "name": "知芝",
      "gender": "female"
    },
    {
      "id": "Ethan",
      "name": "晨煦",
      "gender": "neutral"
    },
    {
      "id": "Harvey",
      "name": "厚",
      "gender": "neutral"
    }
  ],
  "qwen-audio-3.1-realtime-plus": [
    {
      "id": "longanqian_v3.1",
      "name": "默认客服音色",
      "gender": "neutral"
    },
    {
      "id": "longanqian",
      "name": "系统音色 02",
      "gender": "neutral"
    },
    {
      "id": "longanlingxin",
      "name": "系统音色 03",
      "gender": "neutral"
    },
    {
      "id": "longanlingxi",
      "name": "系统音色 04",
      "gender": "neutral"
    },
    {
      "id": "longanxiaoxin",
      "name": "系统音色 05",
      "gender": "neutral"
    },
    {
      "id": "longanlufeng",
      "name": "系统音色 06",
      "gender": "neutral"
    },
    {
      "id": "longanhuan_v3.1",
      "name": "系统音色 07",
      "gender": "neutral"
    },
    {
      "id": "longanlingxin_v3.1",
      "name": "系统音色 08",
      "gender": "neutral"
    },
    {
      "id": "longanfengyue_v3.1",
      "name": "系统音色 09",
      "gender": "neutral"
    },
    {
      "id": "xunanchuan_v3.1",
      "name": "系统音色 10",
      "gender": "neutral"
    },
    {
      "id": "beth_v3.1",
      "name": "系统音色 11",
      "gender": "neutral"
    },
    {
      "id": "betty_v3.1",
      "name": "系统音色 12",
      "gender": "neutral"
    },
    {
      "id": "cally_v3.1",
      "name": "系统音色 13",
      "gender": "neutral"
    }
  ]
};
