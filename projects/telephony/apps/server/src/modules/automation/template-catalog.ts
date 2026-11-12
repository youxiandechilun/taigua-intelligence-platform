/*
 * 中文导读：自动化流程：template-catalog.ts。相关类型、配置或辅助实现集中在本文件。
 */
// Official n8n template snapshots; downloaded 2026-10-10 and localized for employee learning.
export const learningTemplates = [
  {
    "id": "5170",
    "name": "JSON 数据基础",
    "author": "Lucas Peyrin",
    "description": "无需外部账号；按节点顺序学习文本、数字、布尔值、数组和对象。",
    "steps": [
      "点击开始运行，依次打开各节点。",
      "观察输出数据类型，阅读中文便签。",
      "修改示例字段，再检查最后的综合练习。"
    ],
    "sourceUrl": "https://n8n.io/workflows/5170-learn-json-basics-with-an-interactive-step-by-step-tutorial-for-beginners/",
    "sha256": "54113a4b354ba0b24a547b04c1eb7ae53865ee00ccb1abed513bcf290b7ef501",
    "workflow": {
      "nodes": [
        {
          "id": "365fdd40-4e46-497b-8fef-9c356b2234cd",
          "name": "开始运行",
          "type": "n8n-nodes-base.manualTrigger",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -3456,
            1056
          ],
          "parameters": {},
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "6c2fe8ca-9aa9-402a-949d-cc58177eb7e5",
          "name": "文本",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -2816,
            1056
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "e87952cb-878e-4feb-8261-342eaf887838",
                  "name": "json_example_string",
                  "type": "string",
                  "value": "This is a simple string. In JSON, it's always enclosed in double quotes."
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "3cffa562-bedc-42f9-ab4f-8b55cd3b5711",
          "name": "字段与值",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -3104,
            1056
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "e87952cb-878e-4feb-8261-342eaf887838",
                  "name": "key",
                  "type": "string",
                  "value": "value"
                },
                {
                  "id": "b5f030f4-6650-4181-881f-de44790bb24b",
                  "name": "another_key",
                  "type": "string",
                  "value": "another_value"
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "c4742e5d-8017-45e9-ada5-a2897c87b4cc",
          "name": "数字",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -2528,
            1056
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "e87952cb-878e-4feb-8261-342eaf887838",
                  "name": "json_example_integer",
                  "type": "number",
                  "value": 10
                },
                {
                  "id": "12345",
                  "name": "json_example_float",
                  "type": "number",
                  "value": 12.5
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "60ee473c-635c-41d7-acd2-4fa6c3acb665",
          "name": "布尔值",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -2240,
            1056
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "e87952cb-878e-4feb-8261-342eaf887838",
                  "name": "json_example_boolean",
                  "type": "boolean",
                  "value": false
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "56683e92-19a0-4a17-99a9-b92120739c74",
          "name": "数组",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -1664,
            1056
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "e87952cb-878e-4feb-8261-342eaf887838",
                  "name": "json_example_array",
                  "type": "array",
                  "value": "[\"first element\", 2, false, null]"
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "190c86c7-2d0b-47e1-a729-e22e9610dc8f",
          "name": "对象",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -1360,
            1056
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "e87952cb-878e-4feb-8261-342eaf887838",
                  "name": "json_example_object",
                  "type": "object",
                  "value": "{\"key\":\"value\",\"array\":[1,2,3],\"boolean\":false,\"integer\":123,\"sub_object\":{\"sub_key\":\"Find me!\"}}"
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "24b198bc-9a82-477f-921e-c7e5055d17cc",
          "name": "学习说明1",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -3680,
            560
          ],
          "parameters": {
            "width": 460,
            "height": 656,
            "content": "## JSON 数据基础\nJSON 是应用之间交换数据的格式。可以用它记录姓名、年龄、是否需要跟进以及电话列表。\n\n1. 点击“执行工作流”。\n2. 依次打开节点。\n3. 查看右侧输出和相邻中文便签。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "f9dfa173-b51f-41fb-8587-9c4ee2855265",
          "name": "学习说明2",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -3184,
            704
          ],
          "parameters": {
            "color": 7,
            "width": 260,
            "height": 516,
            "content": "#### 字段与值\n每条数据由字段名称（Key）和值（Value）组成。字段名称使用双引号。\n```json\n{\"key\":\"value\"}\n```\n观察本节点的两组字段与值。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "fc2ad88e-b5cc-4dc4-91e6-f246d1654e26",
          "name": "学习说明3",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -2896,
            704
          ],
          "parameters": {
            "color": 7,
            "width": 260,
            "height": 516,
            "content": "#### 文本\n字符串表示文字，使用双引号包围。查看 `json_example_string` 的输出。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "4973dad8-cce4-490c-8ad1-01410ffb7740",
          "name": "学习说明4",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -2608,
            704
          ],
          "parameters": {
            "color": 7,
            "width": 260,
            "height": 516,
            "content": "#### 数字\n数字直接书写，不加引号。`30` 是数字，`\"30\"` 是文本；进行计算时需区分。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "4240a747-d2de-42dc-882a-55aee236e76a",
          "name": "学习说明5",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -2320,
            704
          ],
          "parameters": {
            "color": 7,
            "width": 260,
            "height": 516,
            "content": "#### 布尔值\n`true` 表示是，`false` 表示否。小写，不加引号。可用于判断条件。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "6eb904bc-a082-43fd-85ea-e672830cdcd2",
          "name": "学习说明6",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -1744,
            704
          ],
          "parameters": {
            "color": 7,
            "width": 260,
            "height": 516,
            "content": "#### 数组\n数组是有顺序的列表，使用 `[` 与 `]`，元素之间用逗号分隔。列表可包含文本、数字、对象等。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "76fa5320-894b-451f-b372-59144fc0ade3",
          "name": "学习说明7",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -1456,
            704
          ],
          "parameters": {
            "color": 7,
            "width": 280,
            "height": 516,
            "content": "#### 对象\n对象是一组字段与值，使用 `{` 与 `}`。对象内可以包含数组和其他对象，用于组织完整资料。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "5976d5fa-6788-46b8-b5e5-1cf6d09f5954",
          "name": "空值",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -1952,
            1056
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "e87952cb-878e-4feb-8261-342eaf887838",
                  "name": "json_example_null",
                  "type": "null",
                  "value": {}
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "7786c224-1cd6-4b05-a41b-d47cde98d2a0",
          "name": "学习说明8",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -2032,
            704
          ],
          "parameters": {
            "color": 7,
            "width": 260,
            "height": 516,
            "content": "#### 空值\n`null` 表示没有值，不能写成 `\"null\"`。它与数字 `0`、空文本 `\"\"` 不同。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "f8f6e7b6-3f48-4e5c-86d6-001ec61d1f81",
          "name": "通过表达式使用数据",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -1024,
            1056
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "e87952cb-878e-4feb-8261-342eaf887838",
                  "name": "message",
                  "type": "string",
                  "value": "=Hello, the number from the tutorial is: {{ $('数字').item.json.json_example_integer }}"
                },
                {
                  "id": "61f385f4-b8e2-4c69-b873-9ffc3ab3fe94",
                  "name": "sub_key",
                  "type": "string",
                  "value": "={{ $json.json_example_object.sub_object.sub_key }}"
                },
                {
                  "id": "bd752a0f-64bf-44b1-b39b-fca28e86aa5b",
                  "name": "array_second_item",
                  "type": "string",
                  "value": "={{ $json.json_example_object.array[1] }}"
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "0b3ddc47-b1ff-4016-957b-cb6f584a996f",
          "name": "学习说明9",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -1152,
            704
          ],
          "parameters": {
            "color": 5,
            "width": 340,
            "height": 516,
            "content": "#### 通过表达式取值\n用 `{{ }}` 引用之前节点的字段。\n`{{ $('数字').item.json.json_example_integer }}`\n会读取数字节点的示例整数。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "d1004e2e-15b6-4108-9811-6e7d980822d3",
          "name": "综合练习",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -672,
            1056
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "e87952cb-878e-4feb-8261-342eaf887838",
                  "name": "summary_string",
                  "type": "string",
                  "value": "={{ $('文本').item.json.json_example_string }}"
                },
                {
                  "id": "12345",
                  "name": "summary_number",
                  "type": "number",
                  "value": "={{ $('数字').item.json.json_example_integer }}"
                },
                {
                  "id": "67890",
                  "name": "summary_boolean",
                  "type": "boolean",
                  "value": "={{ $('布尔值').item.json.json_example_boolean }}"
                },
                {
                  "id": "abcde",
                  "name": "summary_null",
                  "type": "null",
                  "value": "={{ $('空值').item.json.json_example_null }}"
                },
                {
                  "id": "fghij",
                  "name": "summary_array",
                  "type": "array",
                  "value": "={{ $('数组').item.json.json_example_array }}"
                },
                {
                  "id": "klmno",
                  "name": "summary_object",
                  "type": "object",
                  "value": "={{ $('对象').item.json.json_example_object }}"
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "43eb149b-ccd3-4557-b744-ef5d9dcf82d9",
          "name": "学习说明10",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -784,
            704
          ],
          "parameters": {
            "color": 6,
            "width": 340,
            "height": 516,
            "content": "#### 综合练习\n本节点从前面各节点取值，拼成一个完整对象。打开每个字段，观察对应表达式与输出。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "b8fce06f-abe9-45cd-b365-97743a0d8dca",
          "name": "学习说明11",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -416,
            16
          ],
          "parameters": {
            "color": 3,
            "width": 540,
            "height": 1200,
            "content": "## 模板来源\n作者：Lucas Peyrin。来源：n8n 官方模板库。本站提供中文学习版本，原版保存在源码资料中。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "da4af3ac-a717-489d-bb64-3ef34167a0fc",
          "name": "学习说明12",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -3680,
            240
          ],
          "parameters": {
            "color": 2,
            "width": 460,
            "height": 300,
            "content": "## 学习方法\n先执行工作流，再打开每个节点查看数据；不需要外部账号。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "b29ca9fc-7fc2-4dd7-9fca-d2d2a9bae237",
          "name": "学习说明13",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -3184,
            288
          ],
          "parameters": {
            "color": 7,
            "width": 576,
            "height": 392,
            "content": "## 执行工作流\n点击编辑器的执行按钮，查看每个节点的输入与输出。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "0d2835ec-33c8-426b-87cd-74af33011bd5",
          "name": "学习说明14",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：JSON 数据基础。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -784,
            368
          ],
          "parameters": {
            "color": 6,
            "width": 336,
            "height": 312,
            "content": "## 自主练习\n修改示例字段和值，再运行综合练习，检查输出是否符合预期。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        }
      ],
      "pinData": {},
      "connections": {
        "空值": {
          "main": [
            [
              {
                "node": "数组",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "数组": {
          "main": [
            [
              {
                "node": "对象",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "数字": {
          "main": [
            [
              {
                "node": "布尔值",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "对象": {
          "main": [
            [
              {
                "node": "通过表达式使用数据",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "文本": {
          "main": [
            [
              {
                "node": "数字",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "布尔值": {
          "main": [
            [
              {
                "node": "空值",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "字段与值": {
          "main": [
            [
              {
                "node": "文本",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "开始运行": {
          "main": [
            [
              {
                "node": "字段与值",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "通过表达式使用数据": {
          "main": [
            [
              {
                "node": "综合练习",
                "type": "main",
                "index": 0
              }
            ]
          ]
        }
      },
      "name": "JSON 数据基础（中文学习版）",
      "active": false,
      "settings": {
        "executionOrder": "v1",
        "saveDataSuccessExecution": "none",
        "saveDataErrorExecution": "none",
        "saveManualExecutions": false
      }
    }
  },
  {
    "id": "5271",
    "name": "表达式与跨节点取值",
    "author": "Lucas Peyrin",
    "description": "无需外部账号；学习如何从前面的节点取出字段、数组和嵌套数据。",
    "steps": [
      "先运行示例数据节点。",
      "依次查看取值、数组、嵌套对象和函数示例。",
      "修改示例值，检查表达式输出。"
    ],
    "sourceUrl": "https://n8n.io/workflows/5271-learn-n8n-expressions-with-an-interactive-step-by-step-tutorial-for-beginners/",
    "sha256": "dcd8c7106d2ff1915db5d351154a963e7ac99ae60d5280a6fdbfdef897c4355f",
    "workflow": {
      "nodes": [
        {
          "id": "2c20bdef-e54e-46ab-9c63-5cf521ec749e",
          "name": "开始教程",
          "type": "n8n-nodes-base.manualTrigger",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -7360,
            992
          ],
          "parameters": {},
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "25703548-3e48-4951-9e3b-1d7815e15af5",
          "name": "学习说明1",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -7616,
            592
          ],
          "parameters": {
            "color": 5,
            "width": 640,
            "height": 560,
            "content": "# 表达式教程\n表达式写在 `{{ }}` 中，运行时会替换成实际值。先执行“示例数据”，再沿流程逐课观察节点配置与输出。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "b875f86c-a790-49bc-96a0-e1ccc72a5e80",
          "name": "示例数据",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -6720,
            992
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "12345",
                  "name": "name",
                  "type": "string",
                  "value": "Alice"
                },
                {
                  "id": "67890",
                  "name": "age",
                  "type": "number",
                  "value": 30
                },
                {
                  "id": "abcde",
                  "name": "is_active",
                  "type": "boolean",
                  "value": true
                },
                {
                  "id": "fghij",
                  "name": "skills",
                  "type": "array",
                  "value": "[\"JavaScript\",\"Python\",\"n8n\"]"
                },
                {
                  "id": "klmno",
                  "name": "projects",
                  "type": "array",
                  "value": "[{\"name\":\"Project A\",\"status\":\"Done\"},{\"name\":\"Project B\",\"status\":\"In Progress\"}]"
                },
                {
                  "id": "pqrst",
                  "name": "contact",
                  "type": "object",
                  "value": "{\"email\":\"user@example.com\",\"phone\":null}"
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "108d6d9a-6e98-491d-87c1-78d3680f0c40",
          "name": "学习说明2",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -6944,
            640
          ],
          "parameters": {
            "color": 7,
            "width": 520,
            "height": 520,
            "content": "## 示例数据\n数据包含 name（姓名）、age（年龄）、skills（技能列表）、projects（项目列表）、contact（联系资料对象）。后续节点将从这里取值。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "54723ed3-94c5-4104-b1c5-3ac70c262b87",
          "name": "第1课：基本取值",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -6192,
            992
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "12345",
                  "name": "user_name",
                  "type": "string",
                  "value": "={{ $('示例数据').item.json.name }}"
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "81dc9611-b9b5-41c3-a5ab-460cb0dc1ca6",
          "name": "学习说明3",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -6400,
            576
          ],
          "parameters": {
            "color": 2,
            "width": 500,
            "height": 580,
            "content": "## 第1课：基本取值\n`{{ $('示例数据').item.json.name }}` 从指定节点当前关联数据读取 name。`{{ $json.name }}` 读取当前输入。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "b91f6099-5207-4000-9a0e-e6374718c123",
          "name": "第3课：数组取值",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -4960,
            992
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "12345",
                  "name": "second_skill",
                  "type": "string",
                  "value": "={{ $('示例数据').last().json.skills[1] }}"
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "2074d65b-2d6b-41af-a4f9-fa9a195a1bf8",
          "name": "学习说明4",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -5168,
            624
          ],
          "parameters": {
            "color": 4,
            "width": 540,
            "height": 520,
            "content": "## 第3课：数组取值\n`{{ $('示例数据').last().json.skills[1] }}` 读取第二项技能。数组从0开始计数：第一项是 `[0]`。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "8ccc139f-0e8c-4c25-9d04-cecf2b335934",
          "name": "第4课：嵌套对象",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -4400,
            992
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "12345",
                  "name": "user_email",
                  "type": "string",
                  "value": "={{ $('示例数据').last().json.contact.email }}"
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "34264c0c-8282-4b57-a066-0548a31cbf1a",
          "name": "学习说明5",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -4608,
            672
          ],
          "parameters": {
            "color": 5,
            "width": 540,
            "height": 480,
            "content": "## 第4课：嵌套对象\n`{{ $('示例数据').last().json.contact.email }}` 先访问 contact 对象，再读取 email 字段。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "4c41fb6a-5f93-408f-9583-1e118d139dcf",
          "name": "第5课：对象数组",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -3808,
            992
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "12345",
                  "name": "first_project_status",
                  "type": "string",
                  "value": "={{ $('示例数据').last().json.projects[0].status }}"
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "2123cd02-5cb6-4dd7-89e5-7af1c6edf234",
          "name": "学习说明6",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -4048,
            672
          ],
          "parameters": {
            "color": 6,
            "width": 580,
            "height": 480,
            "content": "## 第5课：对象数组\n`{{ $('示例数据').last().json.projects[0].status }}` 读取第一个项目的 status 字段。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "f25a5a9d-518d-4a4a-b2ad-36fd0e1f5bd2",
          "name": "第6课：函数处理",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -3200,
            992
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "12345",
                  "name": "name_in_caps",
                  "type": "string",
                  "value": "={{ $('示例数据').last().json.name.toUpperCase() }}"
                },
                {
                  "id": "67890",
                  "name": "age_in_dog_years",
                  "type": "number",
                  "value": "={{ Math.round($('示例数据').last().json.age / 7) }}"
                },
                {
                  "id": "abcde",
                  "name": "age_data_type",
                  "type": "string",
                  "value": "={{ typeof $('示例数据').last().json.age }}"
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "0ebf5e6b-feb8-4f32-9979-9d7555b461ed",
          "name": "学习说明7",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -3440,
            640
          ],
          "parameters": {
            "color": 3,
            "width": 580,
            "height": 520,
            "content": "## 第6课：函数处理\n`.toUpperCase()` 转换英文大小写；`Math.round(...)` 四舍五入；`typeof` 查看值的类型。保留代码语法。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "81d8c2d6-95cc-47e3-b0f0-9c698a120d1c",
          "name": "第9课：全部数据",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -1264,
            992
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "12345",
                  "name": "all_skills_string",
                  "type": "string",
                  "value": "={{ $('拆分技能数组').all().map(item => item.json.skills).join(', ') }}"
                }
              ]
            }
          },
          "executeOnce": true,
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "609e27f8-1702-493e-bc8b-cbade4561bd2",
          "name": "学习说明8",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -1696,
            640
          ],
          "parameters": {
            "color": 5,
            "width": 780,
            "height": 520,
            "content": "## 第9课：汇总多条数据\n`{{ $('拆分技能数组').all().map(item => item.json.skills).join(', ') }}` 读取全部技能，再拼成一行文本。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "d6afc595-c6f0-47b2-894e-b03d6a0227ee",
          "name": "综合练习",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -688,
            992
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "12345",
                  "name": "final_summary",
                  "type": "string",
                  "value": "=User {{ $('第2课：数据选择器').last().json.user_name_from_first }} is {{ $('示例数据').last().json.age }}.\n\nTheir best skill is {{ $('第3课：数组取值').last().json.second_skill }}.\n\nTheir first project was {{ $('示例数据').last().json.projects[0].name }}, which is now {{ $('第5课：对象数组').last().json.first_project_status }}.\n\nAll skills: {{ $('第9课：全部数据').last().json.all_skills_string }}."
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "99a7fb24-491c-436e-a775-6fabdc2c4004",
          "name": "学习说明9",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -896,
            736
          ],
          "parameters": {
            "color": 6,
            "width": 520,
            "height": 420,
            "content": "## 综合练习\n查看最终对象各字段如何从不同节点读取和处理数据。修改示例值后重新执行，验证自己的理解。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "c3f2fd66-784d-4675-8cb3-72dd33e6ee4e",
          "name": "第2课：数据选择器",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -5568,
            992
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "12345",
                  "name": "user_name_from_first",
                  "type": "string",
                  "value": "={{ $('示例数据').last().json.name }}"
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "bade9e22-6e9d-4f25-a1b7-974cbf2d5c61",
          "name": "学习说明10",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -5872,
            528
          ],
          "parameters": {
            "width": 680,
            "height": 620,
            "content": "## 第2课：数据选择器\n`.first()` 读取第一条，`.last()` 读取最后一条，`.all()` 读取全部。`.item` 用于关联当前输入对应的数据，不可随意替换。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "7c4b718e-fca8-4dbe-8b3b-d6aeeaa78d6d",
          "name": "第7课：查看对象字段",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -2640,
            992
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "12345",
                  "name": "contact_keys",
                  "type": "array",
                  "value": "={{ Object.keys($('示例数据').last().json.contact) }}"
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "089b02d1-e43b-4baf-8bcf-b2dd7a95df92",
          "name": "学习说明11",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -2832,
            640
          ],
          "parameters": {
            "color": 2,
            "width": 500,
            "height": 520,
            "content": "## 第7课：查看字段\n`{{ Object.keys($('示例数据').last().json.contact) }}` 返回联系资料对象的字段名称列表。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "81a16f66-4fca-47af-841c-91e16ff9587e",
          "name": "第8课：数据转文本",
          "type": "n8n-nodes-base.set",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -2064,
            992
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "12345",
                  "name": "contact_as_string",
                  "type": "string",
                  "value": "={{ JSON.stringify($('示例数据').last().json.contact, null, 2) }}"
                },
                {
                  "id": "06003b65-7482-4d5a-b2c0-1794859ab461",
                  "name": "skills",
                  "type": "array",
                  "value": "={{ $('示例数据').last().json.skills }}"
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notesInFlow": false
        },
        {
          "id": "b7aea910-5fd6-420f-9814-77afb8ab9517",
          "name": "学习说明12",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -2304,
            640
          ],
          "parameters": {
            "width": 580,
            "height": 520,
            "content": "## 第8课：数据转文本\n`{{ JSON.stringify($('示例数据').last().json.contact, null, 2) }}` 将对象转为有缩进的文本，方便查看。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "2b83f9a2-7c71-43bb-b940-d0c3204cf6a2",
          "name": "拆分技能数组",
          "type": "n8n-nodes-base.splitOut",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -1488,
            992
          ],
          "parameters": {
            "include": "allOtherFields",
            "options": {},
            "fieldToSplitOut": "skills"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "933a0592-2deb-4db7-b801-d52dbbed1252",
          "name": "学习说明13",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -352,
            -128
          ],
          "parameters": {
            "color": 3,
            "width": 540,
            "height": 1280,
            "content": "## 模板来源\n作者：Lucas Peyrin。来源：n8n 官方模板库。中文版本保留原始字段和表达式语法。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        },
        {
          "id": "efc93cff-1e16-46fc-a839-7cca5ccd27f8",
          "name": "学习说明14",
          "type": "n8n-nodes-base.stickyNote",
          "notes": "中文学习模板：表达式与跨节点取值。原始字段名与代码语法保持不变。",
          "creator": "Lucas Peyrin",
          "position": [
            -896,
            304
          ],
          "parameters": {
            "color": 6,
            "width": 512,
            "height": 408,
            "content": "## 自主练习\n调整示例数据，检查基本取值、数组取值与综合练习的输出是否变化。"
          },
          "typeVersion": 1,
          "notesInFlow": false
        }
      ],
      "connections": {
        "示例数据": {
          "main": [
            [
              {
                "node": "第1课：基本取值",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "第1课：基本取值": {
          "main": [
            [
              {
                "node": "第2课：数据选择器",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "开始教程": {
          "main": [
            [
              {
                "node": "示例数据",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "第4课：嵌套对象": {
          "main": [
            [
              {
                "node": "第5课：对象数组",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "拆分技能数组": {
          "main": [
            [
              {
                "node": "第9课：全部数据",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "第5课：对象数组": {
          "main": [
            [
              {
                "node": "第6课：函数处理",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "第6课：函数处理": {
          "main": [
            [
              {
                "node": "第7课：查看对象字段",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "第2课：数据选择器": {
          "main": [
            [
              {
                "node": "第3课：数组取值",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "第8课：数据转文本": {
          "main": [
            [
              {
                "node": "拆分技能数组",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "第7课：查看对象字段": {
          "main": [
            [
              {
                "node": "第8课：数据转文本",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "第3课：数组取值": {
          "main": [
            [
              {
                "node": "第4课：嵌套对象",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "第9课：全部数据": {
          "main": [
            [
              {
                "node": "综合练习",
                "type": "main",
                "index": 0
              }
            ]
          ]
        }
      },
      "name": "表达式与跨节点取值（中文学习版）",
      "active": false,
      "settings": {
        "executionOrder": "v1",
        "saveDataSuccessExecution": "none",
        "saveDataErrorExecution": "none",
        "saveManualExecutions": false
      }
    }
  },
  {
    "id": "2896",
    "name": "循环与分批处理",
    "author": "Dominik Baranowski",
    "description": "无需外部账号；理解单条数据中的数组与多条数据的区别。含代码节点，仅用于学习。",
    "steps": [
      "在手动触发节点添加包含 urls 数组的固定示例数据。",
      "比较拆分前后的数据条数。",
      "观察逐条运行与一次处理全部数据的差别。"
    ],
    "sourceUrl": "https://n8n.io/workflows/2896-n8n-for-beginners-looping-over-items/",
    "sha256": "3a5e525fafa5632179386ef0708ea4f5d1787094d530438779b1414d6c75c588",
    "workflow": {
      "name": "循环与分批处理（中文学习版）",
      "nodes": [
        {
          "id": "500304a1-5164-4907-b0a7-e514e455e3dc",
          "name": "查看结果1",
          "type": "n8n-nodes-base.noOp",
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "position": [
            880,
            -280
          ],
          "parameters": {},
          "notesInFlow": false,
          "typeVersion": 1
        },
        {
          "id": "32808ad1-1a35-497f-b1d3-c935a924c541",
          "name": "查看结果2",
          "type": "n8n-nodes-base.noOp",
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "position": [
            880,
            40
          ],
          "parameters": {},
          "notesInFlow": false,
          "typeVersion": 1
        },
        {
          "id": "f3c9fa5d-a4c7-4cf0-beb5-774d8483974f",
          "name": "学习说明1",
          "type": "n8n-nodes-base.stickyNote",
          "position": [
            800,
            -340
          ],
          "parameters": {
            "color": 3,
            "width": 320,
            "height": 240,
            "content": "### 结果1\n未拆分的文本数组仍属于一条数据，循环节点看到的是一条记录。"
          },
          "typeVersion": 1,
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "0bb96765-60ce-4618-9b39-7cd203a3cb48",
          "name": "学习说明2",
          "type": "n8n-nodes-base.stickyNote",
          "position": [
            800,
            -60
          ],
          "parameters": {
            "color": 3,
            "width": 320,
            "height": 260,
            "content": "### 结果2\n拆分数组后，每个元素成为一条记录，循环节点可以逐条处理。"
          },
          "typeVersion": 1,
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "b71fcc86-b0cd-4241-b0d6-21abe4c6b68d",
          "name": "学习说明3",
          "type": "n8n-nodes-base.stickyNote",
          "position": [
            -1680,
            -1100
          ],
          "parameters": {
            "width": 1200,
            "height": 2480,
            "content": "# 循环与分批处理\n多数 n8n 节点默认处理输入的每条记录。“逐条循环”节点可控制每批数量，并串联多个处理步骤。\n\n在手动触发节点添加固定示例数据：\n```json\n{\"urls\":[\"https://example.com/1\",\"https://example.com/2\",\"https://example.com/3\"]}\n```\n这些网址只是示例文本，本流程不会访问它们。比较数组拆分前后与代码节点不同运行方式的输出。"
          },
          "typeVersion": 1,
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "53e7d23a-2a4f-4ada-aeb5-de128acf8625",
          "name": "将数组拆分为多条数据",
          "type": "n8n-nodes-base.splitOut",
          "position": [
            -20,
            380
          ],
          "parameters": {
            "options": {
              "destinationFieldName": "url"
            },
            "fieldToSplitOut": "urls"
          },
          "typeVersion": 1,
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "4910fec6-d600-43be-97b2-5050039db416",
          "name": "学习说明4",
          "type": "n8n-nodes-base.stickyNote",
          "position": [
            800,
            700
          ],
          "parameters": {
            "color": 3,
            "width": 320,
            "height": 260,
            "content": "### 结果4\n代码节点选择“一次处理全部数据”后，会统一接收所有记录。"
          },
          "typeVersion": 1,
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "f0e68b30-5341-4672-8d8e-7a24d894eb03",
          "name": "学习说明5",
          "type": "n8n-nodes-base.stickyNote",
          "position": [
            800,
            420
          ],
          "parameters": {
            "color": 3,
            "width": 320,
            "height": 240,
            "content": "### 结果3\n默认逐条执行时，每条记录分别添加示例字段。"
          },
          "typeVersion": 1,
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "70a987b9-6a4a-49c3-a87c-0dd9cc1879ed",
          "name": "查看结果3",
          "type": "n8n-nodes-base.noOp",
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "position": [
            900,
            500
          ],
          "parameters": {},
          "notesInFlow": false,
          "typeVersion": 1
        },
        {
          "id": "9de5fac9-e987-4fb1-8f7f-b59af2985e5c",
          "name": "查看结果4",
          "type": "n8n-nodes-base.noOp",
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "position": [
            900,
            780
          ],
          "parameters": {},
          "notesInFlow": false,
          "typeVersion": 1
        },
        {
          "id": "d5fee847-7758-44ac-a270-6334dd81bb97",
          "name": "学习说明6",
          "type": "n8n-nodes-base.stickyNote",
          "position": [
            800,
            -640
          ],
          "parameters": {
            "color": 3,
            "width": 320,
            "height": 260,
            "content": "### 结果5\n未拆分的数组在代码节点中仍是一条记录，其行为与结果1相同。"
          },
          "typeVersion": 1,
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "9a134620-4067-4c7a-8b0f-30e19c93a66c",
          "name": "查看结果5",
          "type": "n8n-nodes-base.noOp",
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "position": [
            880,
            -540
          ],
          "parameters": {},
          "notesInFlow": false,
          "typeVersion": 1
        },
        {
          "id": "c273cd55-708d-4f86-81f2-3bbe991f59f8",
          "name": "在此节点添加示例数据",
          "type": "n8n-nodes-base.manualTrigger",
          "position": [
            -400,
            -540
          ],
          "parameters": {},
          "typeVersion": 1,
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "8f64b987-05c5-43a9-89c0-201499df0aa6",
          "name": "添加示例字段5",
          "type": "n8n-nodes-base.code",
          "position": [
            320,
            -540
          ],
          "parameters": {
            "jsCode": "\n  $json.param1 =  'add_me_to_all_items_and_name_me_param1';\n\n\nreturn $json"
          },
          "typeVersion": 2,
          "alwaysOutputData": true,
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "4920b4e4-b511-4059-b38a-623d14b6df25",
          "name": "添加示例字段1",
          "type": "n8n-nodes-base.code",
          "position": [
            500,
            -180
          ],
          "parameters": {
            "mode": "runOnceForEachItem",
            "jsCode": "\n  $json.param1 = \"add_me_to_all_items_and_name_me_param1\"\n\nreturn $json"
          },
          "typeVersion": 2,
          "alwaysOutputData": true,
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "28ce5239-6437-4b7a-9395-3beb162fded6",
          "name": "逐条循环2",
          "type": "n8n-nodes-base.splitInBatches",
          "position": [
            320,
            60
          ],
          "parameters": {
            "options": {}
          },
          "typeVersion": 3,
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "628edc5e-1b7f-4f50-9c29-8990bd4a5cc0",
          "name": "逐条循环1",
          "type": "n8n-nodes-base.splitInBatches",
          "position": [
            320,
            -260
          ],
          "parameters": {
            "options": {
              "reset": false
            }
          },
          "typeVersion": 3,
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "ffccda97-066d-4c13-b4eb-a13ff849b90a",
          "name": "添加示例字段2",
          "type": "n8n-nodes-base.code",
          "position": [
            680,
            220
          ],
          "parameters": {
            "mode": "runOnceForEachItem",
            "jsCode": "\n  $json.param1 =   \"add_me_to_all_items_and_name_me_param1\"\n\n\nreturn $json"
          },
          "typeVersion": 2,
          "alwaysOutputData": true,
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "6fb44840-6365-46db-9c50-eecd420f274f",
          "name": "添加示例字段3",
          "type": "n8n-nodes-base.code",
          "position": [
            320,
            500
          ],
          "parameters": {
            "mode": "runOnceForEachItem",
            "jsCode": "\n  $json.param1 =   \"add_me_to_all_items_and_name_me_param1\"\n\n\nreturn $json"
          },
          "typeVersion": 2,
          "alwaysOutputData": true,
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "51b8d766-25ed-407f-a956-693b93bda95f",
          "name": "添加示例字段4",
          "type": "n8n-nodes-base.code",
          "position": [
            320,
            780
          ],
          "parameters": {
            "jsCode": "\n  $json.param1 =   \"add_me_to_all_items_and_name_me_param1\"\n\n\nreturn $json"
          },
          "typeVersion": 2,
          "alwaysOutputData": true,
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "f8edde34-cf47-42e2-bbd3-552df2509451",
          "name": "等待1秒（教学演示）",
          "type": "n8n-nodes-base.wait",
          "position": [
            480,
            180
          ],
          "webhookId": "61aef80b-4e9d-43ae-a083-cd87b4fdec11",
          "parameters": {
            "amount": 1
          },
          "typeVersion": 1.1,
          "notes": "中文学习模板：循环与分批处理。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        }
      ],
      "active": false,
      "pinData": {},
      "settings": {
        "executionOrder": "v1",
        "saveDataSuccessExecution": "none",
        "saveDataErrorExecution": "none",
        "saveManualExecutions": false
      },
      "connections": {
        "查看结果1": {
          "main": [
            []
          ]
        },
        "查看结果2": {
          "main": [
            []
          ]
        },
        "逐条循环1": {
          "main": [
            [
              {
                "node": "查看结果1",
                "type": "main",
                "index": 0
              }
            ],
            [
              {
                "node": "添加示例字段1",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "逐条循环2": {
          "main": [
            [
              {
                "node": "查看结果2",
                "type": "main",
                "index": 0
              }
            ],
            [
              {
                "node": "等待1秒（教学演示）",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "添加示例字段1": {
          "main": [
            [
              {
                "node": "逐条循环1",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "添加示例字段2": {
          "main": [
            [
              {
                "node": "逐条循环2",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "添加示例字段3": {
          "main": [
            [
              {
                "node": "查看结果3",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "添加示例字段4": {
          "main": [
            [
              {
                "node": "查看结果4",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "添加示例字段5": {
          "main": [
            [
              {
                "node": "查看结果5",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "在此节点添加示例数据": {
          "main": [
            [
              {
                "node": "将数组拆分为多条数据",
                "type": "main",
                "index": 0
              },
              {
                "node": "添加示例字段5",
                "type": "main",
                "index": 0
              },
              {
                "node": "逐条循环1",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "等待1秒（教学演示）": {
          "main": [
            [
              {
                "node": "添加示例字段2",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "将数组拆分为多条数据": {
          "main": [
            [
              {
                "node": "逐条循环2",
                "type": "main",
                "index": 0
              },
              {
                "node": "添加示例字段4",
                "type": "main",
                "index": 0
              },
              {
                "node": "添加示例字段3",
                "type": "main",
                "index": 0
              }
            ]
          ]
        }
      }
    }
  },
  {
    "id": "1750",
    "name": "接收请求并返回结果",
    "author": "Jonathan",
    "description": "无需外部账号；学习 Webhook 接收参数和返回结果。发布接口需管理员配置。",
    "steps": [
      "由管理员在编辑器中打开 Webhook 节点的测试监听。",
      "向测试地址传入 first_name 和 last_name 参数。",
      "查看返回的查询网址；示例只生成网址，不执行搜索。"
    ],
    "sourceUrl": "https://n8n.io/workflows/1750-creating-an-api-endpoint/",
    "sha256": "66312c9143a7e122a508caa53c82e5c3899eb58fecd18c6b63c6ca09da86c038",
    "workflow": {
      "nodes": [
        {
          "id": "f80aceed-b676-42aa-bf25-f7a44408b1bc",
          "name": "接收请求",
          "type": "n8n-nodes-base.webhook",
          "position": [
            375,
            115
          ],
          "webhookId": "6f7b288e-1efe-4504-a6fd-660931327269",
          "parameters": {
            "path": "6f7b288e-1efe-4504-a6fd-660931327269",
            "options": {},
            "responseMode": "responseNode"
          },
          "typeVersion": 1,
          "notes": "中文学习模板：接收请求并返回结果。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "3b9ec913-0bbe-4906-bf8e-da352b556655",
          "name": "学习说明1",
          "type": "n8n-nodes-base.stickyNote",
          "position": [
            355,
            -25
          ],
          "parameters": {
            "width": 600,
            "height": 280,
            "content": "## 创建简单接口\n通过“接收请求”与“返回响应”节点读取请求参数，并返回生成的查询网址。"
          },
          "typeVersion": 1,
          "notes": "中文学习模板：接收请求并返回结果。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "9c36dae5-0700-450c-9739-e9f3eff31bfe",
          "name": "返回响应",
          "type": "n8n-nodes-base.respondToWebhook",
          "position": [
            815,
            115
          ],
          "parameters": {
            "options": {},
            "respondWith": "text",
            "responseBody": "=The URL of the Google search query for the term \"{{$node[\"接收请求\"].json[\"query\"][\"first_name\"]}} {{$node[\"接收请求\"].json[\"query\"][\"last_name\"]}}\" is: {{$json[\"product\"]}}"
          },
          "typeVersion": 1,
          "notes": "中文学习模板：接收请求并返回结果。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "5a228fcb-78b9-4a28-95d2-d7c9fdf1d4ea",
          "name": "生成查询网址",
          "type": "n8n-nodes-base.set",
          "position": [
            595,
            115
          ],
          "parameters": {
            "values": {
              "string": [
                {
                  "name": "product",
                  "value": "=https://www.google.com/search?q={{$json[\"query\"][\"first_name\"]}}+{{$json[\"query\"][\"last_name\"]}}"
                }
              ]
            },
            "options": {},
            "keepOnlySet": true
          },
          "typeVersion": 1,
          "notes": "中文学习模板：接收请求并返回结果。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "e7971820-45a8-4dc8-ba4c-b3220d65307a",
          "name": "学习说明2",
          "type": "n8n-nodes-base.stickyNote",
          "position": [
            355,
            275
          ],
          "parameters": {
            "width": 600,
            "height": 220,
            "content": "### 操作步骤\n1. 管理员执行工作流，使测试接口开始监听。\n2. 在测试地址后附加 `?first_name=bob&last_name=dylan`。\n3. 查看返回的 Google 查询网址。这里只生成网址，没有执行搜索。\n正式业务接口的地址和访问权限由管理员配置。"
          },
          "typeVersion": 1,
          "notes": "中文学习模板：接收请求并返回结果。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        }
      ],
      "connections": {
        "接收请求": {
          "main": [
            [
              {
                "node": "生成查询网址",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "生成查询网址": {
          "main": [
            [
              {
                "node": "返回响应",
                "type": "main",
                "index": 0
              }
            ]
          ]
        }
      },
      "name": "接收请求并返回结果（中文学习版）",
      "active": false,
      "settings": {
        "executionOrder": "v1",
        "saveDataSuccessExecution": "none",
        "saveDataErrorExecution": "none",
        "saveManualExecutions": false
      }
    }
  },
  {
    "id": "2990",
    "name": "HTTP 请求与参数配置",
    "author": "Akram Kadri",
    "description": "使用 DummyJSON 公共示例接口，无需密钥；服务器当前仅允许内部请求，外部示例需管理员另行配置。",
    "steps": [
      "在字段节点中设置图片尺寸、文字和颜色。",
      "查看 HTTP 请求节点的地址与参数表达式。",
      "在允许访问外部接口的学习环境运行，查看图片返回结果。"
    ],
    "sourceUrl": "https://n8n.io/workflows/2990-generate-text-images-from-the-free-dummyjson-api-using-the-http-request-node/",
    "sha256": "b3dc7e7343c06568ad315cc31d6f366123dc296ae8f7e7db647a54d43109538c",
    "workflow": {
      "name": "HTTP 请求与参数配置（中文学习版）",
      "nodes": [
        {
          "id": "0a657f21-f0fe-4521-be7f-aa245f86f5d3",
          "name": "手动开始",
          "type": "n8n-nodes-base.manualTrigger",
          "position": [
            340,
            -200
          ],
          "parameters": {},
          "typeVersion": 1,
          "notes": "中文学习模板：HTTP 请求与参数配置。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "54ead951-03fb-4741-9e66-bffa0ff42302",
          "name": "请求示例图片",
          "type": "n8n-nodes-base.httpRequest",
          "position": [
            780,
            -200
          ],
          "parameters": {
            "url": "=https://dummyjson.com/image/{{ $json.size }}/{{ $json.backgroundColor }}/{{ $json.textColor }}",
            "options": {},
            "sendQuery": true,
            "queryParameters": {
              "parameters": [
                {
                  "name": "text",
                  "value": "={{ $json.text }}"
                },
                {
                  "name": "fontSize",
                  "value": "={{ $json.fontSize }}"
                },
                {
                  "name": "type",
                  "value": "={{ $json.type }}"
                },
                {
                  "name": "fontFamily",
                  "value": "={{ $json.fontFamily }}"
                }
              ]
            }
          },
          "typeVersion": 4.2,
          "notes": "中文学习模板：HTTP 请求与参数配置。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "9b60f208-7bbc-4c35-9303-797aabef478d",
          "name": "设置图片参数",
          "type": "n8n-nodes-base.set",
          "position": [
            560,
            -200
          ],
          "parameters": {
            "options": {},
            "assignments": {
              "assignments": [
                {
                  "id": "25b4c572-4ba6-4719-b547-8d3787ba557b",
                  "name": "size",
                  "type": "string",
                  "value": "600x400"
                },
                {
                  "id": "a6689fdb-b212-4c88-b80f-64aabe61daa1",
                  "name": "backgroundColor",
                  "type": "string",
                  "value": "cc22e3"
                },
                {
                  "id": "f9dcc452-4dd5-46fc-948b-39194bf0637d",
                  "name": "textColor",
                  "type": "string",
                  "value": "ffffff"
                },
                {
                  "id": "89842462-d3ac-4267-a40a-3e98e8823ef3",
                  "name": "text",
                  "type": "string",
                  "value": "Generated!"
                },
                {
                  "id": "59eb064d-1cc3-4b7d-92ec-594dadbd38cd",
                  "name": "fontSize",
                  "type": "string",
                  "value": "100"
                },
                {
                  "id": "ccbae0db-559a-4de2-be63-4238feca6498",
                  "name": "fontFamily",
                  "type": "string",
                  "value": "pacifico"
                },
                {
                  "id": "ab88695a-d223-4f26-9ded-3e4c965ca28c",
                  "name": "type",
                  "type": "string",
                  "value": "png"
                }
              ]
            }
          },
          "typeVersion": 3.4,
          "notes": "中文学习模板：HTTP 请求与参数配置。原始字段名与代码语法保持不变。",
          "notesInFlow": false
        },
        {
          "id": "zh-http-guide",
          "name": "中文学习说明",
          "type": "n8n-nodes-base.stickyNote",
          "typeVersion": 1,
          "position": [
            0,
            -260
          ],
          "parameters": {
            "content": "## HTTP 请求与参数配置\n先修改图片宽高、文字、颜色，再查看请求地址如何引用这些参数。接口返回示例图片，无需密钥。\n实际运行需网络可访问 DummyJSON；当前服务器仅允许内部服务请求。",
            "width": 520,
            "height": 240
          }
        }
      ],
      "active": false,
      "pinData": {},
      "settings": {
        "executionOrder": "v1",
        "saveDataSuccessExecution": "none",
        "saveDataErrorExecution": "none",
        "saveManualExecutions": false
      },
      "connections": {
        "设置图片参数": {
          "main": [
            [
              {
                "node": "请求示例图片",
                "type": "main",
                "index": 0
              }
            ]
          ]
        },
        "手动开始": {
          "main": [
            [
              {
                "node": "设置图片参数",
                "type": "main",
                "index": 0
              }
            ]
          ]
        }
      }
    }
  }
] as const;
