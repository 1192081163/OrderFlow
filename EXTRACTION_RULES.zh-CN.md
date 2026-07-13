# 订单提取规则说明

本文按输出表 `订单整理结果.xlsx` 的列顺序整理当前订单提取规则。规则来源于 `extract.py`、`desktop_runner.py` 和 `rules/` 目录下的 CSV 配置表。

订单字段识别、分类和计算只在 Python 中实现。TypeScript 仅负责启动 Python 进程、传递参数和接收结果，不维护第二套提取规则。

## 适用范围

- 支持输入 `.xlsx`、`.xlsm` 订单文件。
- 自动跳过临时 Excel 文件（如 `~$...`、`.~...`）、文件名包含 `job track` 的文件、`总表.xlsx` 和非订单 Excel。
- 支持的订单工作簿结构：
  - `Worksheet` 标准结构：第 9 行为 `Material / Qty / Profile` 等明细表头。
  - `Worksheet` 非标准结构：通过 `Door #`、`Qty` 等表头识别明细。
  - `Main Sheet` 结构。
  - 只有 `Sheet1` 的结构。
- 隐藏行不参与明细、数量、配件、超宽等计算。
- 同一个 Job 重复出现时只保留最新版：优先按文件名里的版本号排序，没有版本号时按文件修改时间排序。
- 输出目录固定为输入基准目录下的 `order_extraction_output/`；桌面流程最终只保留 `订单整理结果.xlsx`。

## 按列规则

| 列 | 表头 | 提取/计算规则 |
| --- | --- | --- |
| A | `D DATE` | 当前不自动填写，保持空白。 |
| B | `PO NUMBER` | 从订单中的 PO 字段读取：`Worksheet` 用 `C6` 或 `Data!G2`；`Main Sheet`/`Sheet1` 优先找 `PO`、`PO No`、`PO Number`、`Purchase Order` 等标签，回退到 `B6`。会去掉末尾方括号备注；纯数字会去前导零。`DANZE` 的 Door Skin 订单若 PO 形如 `12-3456-78`，会取中间段 `3456`。 |
| C | `BUILDER` | 从 Builder/Invoice 字段读取：`Worksheet` 用 `C2` 或 `Data!C2`；`Main Sheet`/`Sheet1` 优先找 `Builder`、`Invoice` 标签，回退到 `B2`。先套用内置客户别名和 `rules/builder_aliases.csv`，找不到别名时保留原文，并在 `audit.csv` 的 `manual_check` 中记录 `builder alias not mapped`。 |
| D | `Urgent` | 当前不自动填写，保持空白。 |
| E | 空表头 | 实际存放 Delivery Zone。`Worksheet` 用 `C7` 或 `Data!I2`；`Main Sheet`/`Sheet1` 会从 Delivery Address 单元格中拆出形如 `12A` 的区域前缀，也会读取 `delivery zone`、`zone`、`location` 等标签或回退到 `B7`。形如两位数字加字母的 Zone 会转大写。 |
| F | `Deliver Address` | `Worksheet` 用 `C4` 或 `Data!E2`；`Main Sheet`/`Sheet1` 从 `Delivery Address`、`Address` 等标签读取，回退到 `B4`。`pickup` 会统一成 `PICK UP`，文本中的 `PICKUP` 会改为 `PICK UP`。 |
| G | `#` | Job 编号。`Worksheet` 用 `C1` 或 `Data!A2`；`Main Sheet`/`Sheet1` 从 `A1` 或文件名解析。识别 `#12345` 或独立的 4-6 位数字/数字加字母。 |
| H | `Over Size` | 仅在启用人工推断时填写。若表内出现 `GLUT`、`PALLET`、`STILLAGE`，优先写入 `glut`、`pallet`、`stillages`。否则统计宽度大于 `1024` 的明细数量；标准表、Profile 表、Cavity/Profileless 表会分别按各自的 Width 列判断。`Other` 行、隐藏行不计入。遇到 `STILLAGE`、`PALLET` 或 Double 但无法确定数量时，会在 `manual_check` 中提示需要人工确认。 |
| I | 空表头 | 当前不自动填写，保持空白。 |
| J | `Material` | 从明细行或 Material 标签提取材料代码并合并去重。识别规则包括：`Zinc/Zincanneal` -> `Z`，`Galv/Galvanised/Galvanized` -> `G`，Colorbond 颜色或 `Colorbond/Colourbond` -> `CB`，`Stainless` -> `SS`，`Aluminium/Aluminum` -> `Aluminium`。厚度 `0.55` 归一为 `0.6`，`1.05` 归一为 `1`。多个材料按厚度和后缀排序后用 `/` 拼接。 |
| K | `QTY` | Goods1 的数量。按产品类型汇总后，取数量最大的产品组；数量相同则保留源文件出现顺序。非正数数量不会冲减总数。 |
| L | `Goods1` | Goods1 的产品类型。主要映射：Cavity/Slider/COWDROY/Closing Jamb -> `CS`；Service Part -> `PART`；Skin/Door Skin -> `DS`；普通 Split 和原文为 `Deluxe Split` -> `SPLIT`，带独立 `DL` 标记的 Split -> `SPLIT DL`；Knock/KD -> `KD`；Modern -> `MODERN`；Deluxe -> `DELUXE`；Custom/Commercial 或常见商业 Profile 代码 -> `COMMERCIAL`；Capping -> `CAPPING`；Door Stop Build Up 文件 -> `CP`；Trad Dyna 文件 -> `COMMERCIAL`；Door Skin 文件中 Flat Sheet -> `DS`，Capping 行不自动回退成 Commercial。 |
| M | `QTY` | Goods2 的数量。若存在第二个产品组，取第二大产品组数量。 |
| N | `Goods2` | Goods2 的产品类型。若超过两个产品组，只输出前两个，并在 `manual_check` 中记录 `more than two goods groups found`。`rules/goods_ignore_patterns.csv` 中的描述不会成为 Goods，也不会产生未映射提示。 |
| O | `Ideal D date` | 订单交期。`Worksheet` 用 `C5` 或 `Data!F2`；`Main Sheet`/`Sheet1` 优先找 `Delivery Date`、`Delivery D`、`Date` 标签，回退到 `B5`。支持 Excel 日期、`YYYY-MM-DD`、`DD/MM/YYYY`、`MM/DD/YYYY`。`Sheet1` 中无法解析的日期会写入 `manual_check`。 |
| P | `Estimate C Date` | 仅在启用人工推断时填写。取 O 列交期的前一个西澳工作日；会跳过周末和 `rules/wa_public_holidays_2026.csv` 中标记为 `holiday` 的日期，`workday` 可作为例外工作日。 |
| Q | 空表头 | 仅在启用人工推断且 P 列有值时填写，内容为 P 列日期的英文星期名，如 `Monday`。 |
| R | `MITRE` | 当前不自动填写，保持空白。该列属于汇总/排程类人工列。 |
| S | `Parts` | 当前不自动填写，保持空白。该列属于汇总/排程类人工列。 |
| T | `MITRE` | 仅在启用人工推断时填写。主要规则：`SPLIT`/`SPLIT DL` 通常按数量乘 2，Double 时乘 3，`Part A/B Only` 按 1；`CS` 每樘按 `14`；`MODERN`、`DELUXE`、`COMMERCIAL` 通常每樘按 1；商业 Double 会额外加 mitre，Double Action 按半个额外量处理；若 Goods1 为 `KD`，T 列会置为 `0`。 |
| U | `Parts` | 仅在启用人工推断时填写。由 V/W/X 和额外配件换算：`U = V + W * 系数 + X * 0.43 + 额外配件`，按 Excel 0 位小数显示方式四舍五入。W 系数默认 `1.43`，部分 Screw Fixed、商业配件场景会改用 `1.0`。额外配件包括部分 Holes、Deluxe Dry Lining Cleats 等规则。 |
| V | `hinge/striker/stud/dynabolt/2110/sill` | 仅在启用人工推断时填写。统计普通铰链、striker、stud、dynabolt、2110、sill 等可识别硬件。`Sheet1` 中 `CSK + DTNA` 按每数量 2 件，`CSK + DYNA + TUBE` 按 4 件，`TRADITION/TRAD + DYNA` 按 1 件。无 Hinge Plate 的 hinge 数量通常进 V。 |
| W | `hinge holder/3751/WS7/mib` | 仅在启用人工推断时填写。统计 `HINGE HOLDER`、`3751`、`WS7`、`MIB` 以及部分 Screw Fixed/Hinge Plate 场景。部分商业或 Screw Fixed 规则会让 W 在 U 列换算时使用 `1.0` 系数。 |
| X | `door closer/kd` | 仅在启用人工推断时填写。当前主要由 `KD` 产品贡献，通常按数量乘 `4` 进入 X；这部分不会再进入 V。 |

## 产品类型补充规则

- `PROFILE_ALIASES` 中的单字母或短 Profile（如 `A`、`B`、`C`、`CUSTOM` 等）会归为 `COMMERCIAL`。
- `Sheet1`/`Main Sheet` 的 Profileless 表如果没有明确产品类型，通常按商业门 `COMMERCIAL` 处理；Cavity 表中的 Modern/Deluxe 会归为 `CS`。
- Cavity 表里的 Soft Closer/Soft Close 附件不计为 `CS` 产品。
- Replacement Head Only 行在 `Sheet1` Cavity 场景中不计为 `KD`；标准 `Worksheet` 中的 Knockdown Head Only 订单仍按 `KD` 产品处理。
- Door Skin 文件名会影响分类：Door Skin 文件中的普通行默认 `DS`，Flat Sheet 也归 `DS`，Capping 行不会自动归为 Commercial。
- `DELUXE DRY LINING` 在内部用于配件计算，输出 Goods 时仍显示为 `DELUXE`。

## 配置表

| 文件 | 当前用途 |
| --- | --- |
| `rules/builder_aliases.csv` | 维护客户名称别名，格式为 `source,builder`。`source` 是订单中的原始客户名，`builder` 是输出到 C 列的名称。 |
| `rules/goods_ignore_patterns.csv` | 维护应忽略的非产品描述。命中后不会写入 Goods，也不会产生 `goods type not mapped`。 |
| `rules/wa_public_holidays_2026.csv` | 维护西澳 2026 节假日/例外工作日，用于 P/Q 列计算。`holiday` 表示非工作日，`workday` 表示例外工作日。 |
| `rules/china_workdays_2026.csv` | 当前 Python 提取器未读取此文件；P/Q 列按西澳工作日规则计算。 |

## 人工检查与审计

`audit.csv` 会记录每个源文件的 `notes`、`manual_check`、已填列和直接提取列的空白情况。常见人工检查提示包括：

- `builder alias not mapped`：客户名没有匹配到别名。
- `goods type not mapped`：产品/Profile 无法归类。
- `more than two goods groups found`：产品组超过两个，输出表只放前两个。
- `delivery date not parsed`：交期无法解析。
- `Over Size requires manual entry`：超宽/包装信息需要人工确认。
- `Sheet1 profile header not found`：找不到可识别的 Profile 明细表。
- `unsupported workbook layout`：工作簿结构不在当前支持范围内。

## 维护建议

- 新增客户名称优先改 `rules/builder_aliases.csv`。
- 新增应忽略的附件/锁具/非产品描述优先改 `rules/goods_ignore_patterns.csv`。
- 修改 P/Q 列日期逻辑时，优先维护 `rules/wa_public_holidays_2026.csv`，并确认是否需要让代码读取其它日历文件。
- 改动提取规则后建议运行：

```bash
python -m pytest tests
```
