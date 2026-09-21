

--Order List

Per Supplier (as is)

📋 Copy parts list | Save PO (creates PO Record)| Print PO | Save & Email to Supplier (later)|



-- Purchase Orders

[📦 Receive stock] (also in stock - keep import as is for now plan is to change this phase 2 create an ai connection, attachment or text input Connect AI Vision to gather data genearte json and script to insert into database - phase 3+++ either email forward to same ai worflow or find more use cases for an mcp/agent connection and do tasks like scan email get invoices from suppliers send info to crm kind of thing) 

PO list (left list) 
PO#
Supplier
Status (waiting to receive(sent), partially receoved, closed (received in full) (need table for PO + stock ordered lines?)

PO table Details (main)
Above Table Header: PO#, Date, Supplier, Invoice, Status
Order list Table line items 
- Item, qty ordered, cost, qty received 


## Table `receipts`  rename to purchase orders
### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `po_ref` | (pretty reference) 
| `occurred_at` | `date` |  |
| `supplier_id` | `int8` |  Nullable |
| `invoice_ref` | `text` |  |
| `item_count` | `int4` |  |
| `total_units` | `int4` |  |
| `created_at` | `timestamptz` |  |
| `po_amount` |  
| `po_status` | 

(allows po to be found by PO Ref plus combination of supplier, amount and order date)

New Table Purchase order items?
| `id` | `int8` | Primary Identity |
purchase_order_id
stock_id
qty_ordered,
cost, 
qty_received 



--Suppliers  

## Table `suppliers`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `name` | `text` |  |
| `phone` | `text` |  |
| `email` | `text` |  |
| `notes` | `text` |  |


Supplier name (left list) 

Supplier Details (main)
Supplier Name
	Phone	Email	
    Notes

PO list Table
PO#, Date, Supplier, Invoice, Status [link to PO]




