

## Table `stocks`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `name` | `text` |  |
| `qty` | `int4` |  |
| `preferred_supplier_id` | `int8` |  Nullable |
| `category` | `ces_category` |  |
| `manufacturer` | `text` |  |
| `model` | `text` |  |
| `kva` | `numeric` |  Nullable |
| `kw` | `numeric` |  Nullable |
| `kwh` | `numeric` |  Nullable |
| `watts` | `numeric` |  Nullable |
| `verified` | `bool` |  |
| `last_cost` | `numeric` |  |


#Main table on page
[Add New] > button opens panel (ideally not have to input name first, then open and edit   [📦 Receive stock]
---
Quick show Filter list  [battery] [Inverter] [Panel] [Other] [Out of stock] 
---
[text Search/filter table on Item, manufacturer, category, model]
---
Item  | Category   |   On hand | Allocated | Available | Last Cost | Preferred Supplier 
Text  | [Text tag] |   [input] | num       | num       | [input]   | [dropdown] 

# Side panel on item click 

Shows Editable Fields (same format for add New) 
**Item Details**
| `name` | `text` | 
| `category` | `ces_category` |  |
| `manufacturer` | `text` |  |
| `model` | `text` |  |

**Stock Details**
| `preferred_supplier_id` | `int8` |  Nullable |
| `last_cost` | `numeric` |  |

|On hand | Allocated (calculated)| Available (calculated)|

**CEC Specification Details**
| `kva` | `numeric` |  Nullable |
| `kw` | `numeric` |  Nullable |
| `kwh` | `numeric` |  Nullable |
| `watts` | `numeric` |  Nullable |

| `verified` | `bool` |  |


#basic styling notes
needs verticle scroll enabled
padding around main section