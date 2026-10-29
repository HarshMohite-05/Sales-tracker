# Nirmaan WaterTech Solutions CRM - Usage Guide

This guide details the operational workflows for **Directors** and **Salespeople** at Nirmaan WaterTech Solutions.

---

## 1. User Accounts and Roles

There are **exactly two user roles**:

### Director Accounts
- **Director 1 (Managing Director)**: Rajesh Sharma (`rajesh.sharma@nirmaanwater.com`)
- **Director 2 (Technical Director)**: Vikram Mehta (`vikram.mehta@nirmaanwater.com`)
- **Default Password**: `Nirmaan@2026`

**Director Capabilities**:
- Company-wide visibility across all clients, salespeople, enquiries, quotations, orders, and financial receipts.
- Review and approve quotation discounts (triggered whenever discount > 3% or custom terms are offered).
- Verify or reject financial receipts submitted by salespeople (only verified receipts reduce invoice balances and count as confirmed collections).
- Set quarterly performance targets per salesperson.
- Configure incentive policies, execute calculation runs, and record payouts with fraud prevention.
- Reassign clients, enquiries, and open tasks between salespeople.
- Post supervisory instructions on any client or quotation.

### Salesperson Accounts
- **Amit Patil**: `amit.patil@nirmaanwater.com` (Senior Sales Engineer - Western Region)
- **Sneha Kulkarni**: `sneha.kulkarni@nirmaanwater.com` (Key Account Manager - Industrial Water)
- **Rahul Deshmukh**: `rahul.deshmukh@nirmaanwater.com` (Sales Executive - OEM & Projects)
- **Default Password**: `Nirmaan@2026`

**Salesperson Capabilities**:
- View assigned clients, requirements, and scheduled follow-ups.
- Add clients using the combined 16-field Daily Activity Tracker workflow.
- Log interactions (Call, WhatsApp, Email, Meeting, Site Visit) with technical & commercial discussion types.
- Schedule and complete follow-up tasks with outcome capture.
- Prepare quotations (R0, R1 revisions) and download formal PDF proposals.
- Record confirmed orders and submit payment receipts with invoice allocations.
- Monitor quarterly achievement against assigned targets.

> **CRITICAL RULE: Follow-up ownership rule**
> All client follow-ups are performed by salespeople only. An overdue escalation alerts both directors, but it does NOT transfer the client task to a director. Exactly one accountable salesperson is assigned per client-facing task.

---

## 2. Daily Salesperson Workflow

### A. Logging in and Reviewing Due Work
1. Navigate to `/login` and select your salesperson account.
2. The **Sales Representative Workspace** opens showing:
   - **Due Today**: Action items scheduled for today.
   - **Overdue Work** (highlighted in red): Requires immediate completion or rescheduling.
   - **Active Pipeline & Targets**: Your quarterly progress.

### B. Adding a New Client or Logging an Existing Interaction
1. Click **`+ Add Client / Tracker`** in the sidebar or top bar.
2. Fill the unified form covering all 16 fields:
   - **Section A**: Company Name, Industry (Pharmaceutical, Chemical, Textiles, etc.), Contact Person, Location, Mobile Number, Email Address.
   - **Section B**: Client Requirement, Lead Stage, Activity Type, Outcome, Discussion Type (Introductory, Technical, Commercial), Key Discussion Points, Remarks.
   - **Section C**: Next Action and Deadline Date/Time.
3. The duplicate search will proactively warn if a company or phone number already exists:
   - If existing, click **"Use Existing"** to auto-fill its profile and attach the new activity.
4. Choose **"Save Client & Follow-up"** or **"Save Client Only"** (if no interaction occurred).

### C. Managing Client Profiles & Multiple Requirements
A client can have multiple separate requirements simultaneously (e.g. *Tirth Water Solutions* having an EDI System Supply enquiry and an RO Plant AMC enquiry).
1. Open any client from `/clients`.
2. Navigate tabs:
   - **Overview**: Basic details, contacts, sites, and summary snapshot.
   - **Enquiries**: View and create separate requirements. Each enquiry has its own stage and value.
   - **Activities**: Historical log of meetings, technical discussions, and calls.
   - **Follow-ups**: Actionable client tasks.
   - **Proposals**: Prepared quotation revisions.
   - **Orders & Billing**: Confirmed orders, milestone invoices, and payment receipts.
   - **Director Notes**: Supervisory instructions from Rajesh Sharma or Vikram Mehta.

### D. Preparing Quotations & Generating PDFs
1. In the client profile or `/proposals`, click **"Prepare Quotation"**.
2. Add line items with descriptions, quantities, units, and rates.
3. The system automatically computes subtotal, GST (18%), and final discounted value.
4. If a discount > 3% is offered, enter the approval justification.
5. Click **"Create Quotation"**.
6. Download the official, professionally styled PDF proposal with company header, itemized pricing table, commercial terms, and signature box.

### E. Recording Confirmed Orders & Marking Enquiries Won
1. Once a proposal is approved and accepted by the client, click **"Confirm Order"**.
2. Enter the Client Purchase Order (PO) number and order date.
3. Confirming the order transactionally marks the linked enquiry as **Won** and logs the booked revenue.

### F. Submitting Payment Receipts
1. In `/orders` or client profile, click **"Record Payment Receipt"**.
2. Enter the amount received, payment mode (NEFT/RTGS, Cheque, UPI), date, and bank UTR reference.
3. Allocate the receipt amount across outstanding client invoices.
4. Any unallocated amount automatically remains as client advance/credit.
5. Submitted receipts remain in the Director verification queue until verified.

---

## 3. Director Supervisory Workflow

### A. Executive Dashboard Monitoring
1. Log in as Director Rajesh Sharma or Vikram Mehta.
2. The **Executive Dashboard** presents:
   - Filter bar: Filter by Date Range, Financial Year, Quarter, Salesperson, Industry, Category, or Stage.
   - Pipeline Overview: Total value of open enquiries.
   - Overdue Follow-ups: Tasks exceeding deadlines with accountable salesperson name.
   - Quotation Approval Queue: Salesperson requests for commercial discounts.
   - Collection Verification Queue: Submitted receipts awaiting verification.
   - Receivables Ageing Breakdown: Categorized into Current, 1-30, 31-60, 61-90, and >90 Days.

### B. Reviewing Quotation Discounts
1. In `/proposals` or dashboard, click **"Review Discount"** on any pending quote.
2. Review the requested discount, original value, final value, and salesperson reason.
3. Choose **Approve** or **Reject** (rejection requires an explicit directive reason).

### C. Verifying Payment Receipts
1. In `/orders` under Collections, review submitted receipts.
2. Click **"Verify Collection"**.
3. Confirm bank statement reflection. Click **"Verify & Confirm Collection"**.
4. The system updates invoice balances to *Partially Paid* or *Paid* and increases verified collections.

### D. Setting Targets & Calculating Incentives
1. Open `/targets`.
2. Use the custom filters to find targets or incentives by salesperson, financial year, or quarter.
3. Click **"Set Target"**, choose the financial year and quarter in the form, and assign Booked Orders or Verified Collections targets per salesperson.
4. Click **"Calculate Quarter Incentives"** to run the incentive engine.
5. Review calculated amounts based on tiered marginal slabs or flat rates.
6. Click **"Approve"** and then **"Record Payout"** with bank voucher reference. The system enforces safety checks preventing duplicate or excess payouts.

### E. Excel Import Wizard
1. Open `/settings` and switch to **"Excel Import Wizard"**.
2. Upload the legacy workbook containing any of the 6 tracker sheets.
3. Map detected sheets and columns.
4. Review preview rows and confirm import.
5. Historical activity rows are saved without triggering live reminder notifications.

## 4. Search

Type a name or detail, such as **Neer**, into the search box. Search matches partial text across all available business fields, regardless of capitalization. There are no conditions to add or fields to choose.

The dashboard search recalculates totals and breakdowns for matching records. Other pages use a compact search box for their current list. On client profiles, search applies across the record tabs and overview summaries. Reports export the same matching rows shown on screen. Clearing the search restores all authorized records. Links from dashboard alerts may open a specific view; use **Clear view** or type a search to replace that view.

Salespeople see only their assigned sales records and their own account. Directors can view all salespeople, company records, targets, and reports. Team management and company settings are available in the director workspace. The sidebar can be collapsed on desktop, and its mobile drawer closes when a page is selected or Escape is pressed.

## Director salesperson analysis

On the dashboard, directors can use **Salesperson analysis** to choose Today, This week, This month, or Custom dates, and view all salespeople or one person. Expand **Daily breakdown** for daily totals. Weeks start Monday and dates use India time. Custom ranges support up to one year.

The report counts new requirements by creation date, logged activities by activity date, completed follow-ups by completion date, sent quotations by sent date, non-cancelled orders by order date, and non-reversed order payments by receipt date. Order value is before GST. Payments are attributed to the order owner. Period totals are separate from the dashboard's current outstanding balances and search.
