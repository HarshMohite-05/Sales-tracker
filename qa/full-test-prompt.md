# Full end-to-end test of the Nirmaan WaterTech CRM

You are testing the Nirmaan WaterTech CRM in this repository (Next.js 15 + Prisma + PostgreSQL). Test every
feature the way real users would: create clients and requirements, log follow-ups, send quotations, confirm
orders, run execution, record payments, set targets, and check that every dashboard card, report and total
shows the right numbers. Work through the plan below in order, because later steps use the data that
earlier steps create.

## Ground rules

1. **Never touch the real data.** Use only the test database, whose name ends in `_test` (see
   `tests/testDatabaseUrl.ts`), and the test server on port 3100 (`qa/start-test-server.ts`). Before you
   create anything, confirm that the server you are calling is on port 3100 and that its `DATABASE_URL` ends in
   `_test`. If you cannot confirm both, stop and report.
2. **Do not change application code.** This is a test run. When something fails, record it with evidence.
   Do not fix it.
3. **Prefix everything you create with `QA-`**, such as client names, PO numbers and requirement titles,
   so test data is easy to recognise.
4. **Check each result, not only the status code.** After every create or change, read the record back.
   Then check that it appears where it should: the client page, the dashboard card and its table, the reports
   and the totals.
5. **Create as much test data as you need.** There is no limit on clients, requirements, follow-ups,
   quotations, orders, payments or targets, as long as it all goes into the test database. Numbers in this
   plan ("at least 6 orders") are minimums, not caps. Cover every combination of the factors listed under
   "Cover every factor" below, and create extra records whenever that helps prove a total, a filter or a
   permission.
6. Use the API through `fetch` with cookies, as `qa/run-workflows.ts` does. Where screens matter, such as the
   modals, dashboard cards and filters, also use the browser runner in `qa/run-browser.ts` if a browser is
   available.

## Setup

1. Make sure Postgres is running: `docker start nirmaan-postgres`. If Docker is down, run `colima start` first.
2. Apply the schema to the test database and seed it. Point `DATABASE_URL` at the `_test` database for these
   commands only, then run `npx prisma db push` and `npm run seed`.
3. Start the test server with `npx tsx qa/start-test-server.ts` and wait until `http://127.0.0.1:3100/login`
   answers.
4. Logins (password `Nirmaan@2026`):
   - Directors: `rajesh.sharma@nirmaanwater.com`, `vikram.mehta@nirmaanwater.com`
   - Salespeople: `amit.patil@nirmaanwater.com`, `sneha.kulkarni@nirmaanwater.com`,
     `rahul.deshmukh@nirmaanwater.com`
5. Run the existing automated suite first, as a baseline: `npm test` (vitest). Record the pass and fail counts.

## Test plan

For every step, test the **normal case**, **invalid input** (empty, wrong type, negative, too long, a date in
the past or far future) and **permissions** (salesperson A on salesperson B's record must get 403 or no data;
a salesperson on director-only actions must get 403).

### Cover every factor

Build test data so that every value below appears at least once, and the important ones in combination
(for example, every requirement type with both a won and a lost outcome, and every payment term with both a
part and a full payment). Spread records across **all three salespeople**, so per-person totals and the
director's team view can be checked.

| Area | Values to cover |
|---|---|
| Client | every industry, at least 4 states, every client type and lead source, with and without GSTIN, one and several contacts, similar names (duplicate warning) |
| Requirement type | Plant, Basic Chemicals, Special Chemicals, Spares, O&M & AMC, Other; one type and several types together |
| Requirement value | 0, small (₹ 5,000), lakhs, crores, decimals |
| Stage | NEW, QUALIFIED, PROPOSAL, NEGOTIATION, ON_HOLD, WON, LOST |
| Activity | call, WhatsApp, email, meeting, site visit; each call outcome and meeting type |
| Follow-up due | overdue by days and by hours, earlier today, later today, tomorrow, next month; completed and rescheduled ones |
| Quotation | one and several items, with and without a discount, 0% / 5% / 12% / 18% GST, several versions, pending, approved and rejected |
| Payment terms | 100% advance; advance + before dispatch + on delivery; terms with erection, installation and commissioning stages; "Full payment after 30 days"; terms typed in differently ("On delivery", "30% commissioning") |
| Order | from a quotation and direct; TDS on/off; retention on/off; cancelled; deleted and restored |
| Targeted completion date | 3 days ago, 1 day ago, today, 1, 2, 3 and 20 days ahead, none; revised once and several times |
| Execution | nothing done, part done, last stage "Not needed", stage added in the middle, earlier stages done but last not done, all done |
| Payment | every mode; part, exact and overpayment; reversed; received on the 31 Mar / 1 Apr boundary |
| Target | each type × each period (month, quarter, 6 months, year); achieved and raised to a next level; with and without a bonus % |
| Users | both directors, all three salespeople, an inactive user |

### 1. Login and sessions
- Correct login works for each role. A wrong password returns 401. An inactive user is refused.
- After 5 or more wrong passwords, login is throttled (429 with Retry-After).
- Every API route returns 401 with no cookie, and with a tampered cookie. Logout ends the session.
- If Postgres is stopped, login shows a clear error rather than crashing the app. Restart Postgres afterwards.

### 2. Clients (Add Client modal, `/clients`, `/clients/[id]`)
- Create as many clients as needed for all three salespeople (and by a director on a salesperson's
  behalf), covering every client factor in the table above.
- Each new client must come with its first requirement. Saving with no requirement, or with no requirement
  type ticked, must fail with a clear message.
- Client codes: an automatic code is suggested. A duplicate code is refused with a suggestion. A code can be
  edited later.
- A similar name triggers the duplicate warning.
- **Use "New Requirement for a Client" (existing client mode) while the client's own page is open.** The new
  requirement must appear on that page without a manual reload. This was a recent bug fix, so retest it.
- Sneha must not see or open Amit's clients. Directors see all clients.
- Search and filters on the Clients list.

### 3. Requirements (enquiries)
- Add requirements from the client page with every type: Plant, Basic Chemicals, Special Chemicals, Spares,
  O&M & AMC, and Other (Other needs its text). Requirement numbers must run in sequence per client
  (e.g. `QA/001`, `QA/002`).
- Move them through the stages NEW → QUALIFIED → PROPOSAL → NEGOTIATION → WON. Also move some to ON_HOLD and
  to LOST (LOST needs a reason). Stage history is recorded.
- Dashboard: Total Leads, Total Enquiry Generated, Pipeline, Orders Lost and Conversion Rate change
  correctly. Each card's table shows the right rows and columns.

### 4. Activities and follow-ups (`/activities`)
- Log a call, WhatsApp, email, meeting and site visit, with and without a next action.
- Create follow-ups due in the past, today and in the future. Then check the Due, Today's and Future
  Follow-ups cards, and that a time later today counts as today, not as due.
- Complete a follow-up, and reschedule one (a reason is required, and the history is kept).
- Notifications appear for the right user only.

### 5. Quotations (`/proposals`)
- Create quotations for as many requirements as needed to cover every quotation and payment-terms factor in
  the table above, with transportation terms. Create several versions of some. Generate the PDF for each kind.
- Approval: a salesperson cannot approve. A director approves or rejects with a note.
- An unapproved quotation cannot be converted to an order.

### 6. Orders: confirm a quotation (Convert to Order modal)
- PO number, PO date and **Targeted Completion Date** are all required in the form.
- Test TDS and retention on and off, with valid and invalid percentages.
- After confirming: the quotation is Accepted, the requirement is WON, and payment stages and Execution rows
  are created from the payment terms.
- Fixed terms ("Full payment after 30 days") give one "Delivery & Invoice Raised" row.
- Create a direct order without a quotation (a reason is required).
- Confirm at least 6 orders, with targeted completion dates **3 days ago, 1 day ago, today, in 2 days, in
  20 days, and none**. Step 7 uses them.

### 7. Execution and the Ongoing Execution Summary card
- Mark Execution rows done with dates, mark rows "Not needed", and add a stage in the middle.
- Order status updates by itself: Confirmed → In execution → Dispatched → Completed.
- **An order counts as delivered only when its last Execution stage is done** (whatever stage that is). If
  the last stage is "Not needed", the stage before it counts as the last. Completing an earlier "Delivery" or
  "Dispatch" row alone must NOT remove the order from the card.
- Revise the targeted completion date: a reason is required, and the history shows the original date →
  the new date with the reason, who changed it and when. A cancelled or delivered order cannot be revised.
- **Ongoing Execution Summary card:** shows the overdue count, then "X due today · Y upcoming", then how many
  orders are in execution. It is red when anything is overdue and amber when something is due today.
- In its table, only ongoing orders appear (delivered orders disappear). The Days and Status columns must
  read:

  | Days | Status |
  |---|---|
  | 3 days overdue | Overdue |
  | 1 day overdue | Overdue |
  | 0 days | Due Today |
  | 2 days left | Upcoming |
  | — (no date) | No date |

- Days filter: **Left + Less than or equal to + 3** shows only orders with 1 to 3 days left. **Overdue +
  Greater than + 2** shows only orders more than 2 days late. **Due today** needs no value. The table has no
  quick-filter buttons. Grouping by Status and by Salesperson works.
- Deleting an order to the Recycle Bin and restoring it keeps its date revision history.

### 8. Payments, invoices and GST
- Record payments against stages in each mode (NEFT/RTGS, cheque, UPI, cash, bank transfer). Test a part
  payment, an exact payment and an overpayment.
- Reverse a payment: it stays on record but drops out of every total.
- Raise the invoice with GST on the right stage. Check TDS and retention deductions and the retention due date.
- Payment Received, Outstanding Payment and Future Due cards, with their tables:
  - Payment Received columns: Sr. No., Payment Date, Enquiry No., PO No., Client, Requirement, Payment Stage,
    Payment Mode, Amount Received.
  - Outstanding ageing buckets: Current, 1–30, 31–60, 61–90 and 90+ days.
- An order with payments cannot be deleted until its payments are reversed.

### 9. Targets and incentives (`/targets`)
- A director sets monthly, quarterly, 6-month and yearly targets of each type: order bookings, collections,
  new enquiries, meetings and quotations sent.
- Achievement counts only records dated inside each target's own period. A quarterly target is not added to
  a yearly one.
- Once a target is achieved, a raised next-level target replaces it ("Target 2 · Raised from …").
- The bonus % applies only to payments after the target is passed.
- Incentives use each business type's rate on the day the payment was received.
- A salesperson cannot create or edit targets.

### 10. Dashboard, reports and filters
- For each salesperson, and for a director viewing the whole team and then each person: every card's total
  equals the sum of the rows in its table.
- Leads table columns, in order: Sr. No., Enquiry No., Date Created, Client, Industry, City, State,
  Requirement, Product Type, Enquiry Value, Stage, Salesperson.
- Search, column filters, number conditions, date range, grouping with subtotals, sorting and pagination
  past 25 rows. Create enough records (e.g. 30+ leads, orders and payments) for pagination to show.
- Load: with a large data set (e.g. 200+ clients, 500+ requirements, 100+ orders), the dashboard, Clients
  list and reports still load in a few seconds. Record the load times. The dashboard view is remembered after a reload.
- The advanced record filters change the cards and tables together.
- Reports page: every report and export (Excel) opens and matches the dashboard.

### 11. Settings, import, recycle bin and worker
- Settings: users (add, deactivate), payment rules, and business-type incentive rates with effective dates.
  Directors only.
- Import: a valid file imports, and a file with bad rows reports them without importing junk.
- Recycle Bin: delete and restore a client, a requirement, a quotation and an order. Restore is refused when
  a number has been reused since. Items expire.
- Reminder worker (`npm run worker` against the test database): overdue follow-ups notify and escalate
  after 24 hours. Email sending stays off.

### 12. Edge cases and safety
- Two saves of the same form at once (double click) must not create duplicates.
- Very long text, emoji, Hindi text and HTML or script in every text field must be stored and shown safely,
  never run as code.
- Indian amounts (₹, lakh and crore formatting) and IST dates around midnight and financial-year boundaries
  (31 Mar / 1 Apr).
- Pages at phone width (375px) and in a narrow window work, with no broken layout.

## Report

When done, write `qa/evidence/full-test-report.md` containing:

1. A summary: total checks, passed, failed and blocked, plus the baseline `npm test` result.
2. A table of every check: ID, module, scenario, expected, actual, and PASS / FAIL / BLOCKED.
3. For each failure: steps to reproduce, the exact request and response (or a screenshot), and how serious it
   is (blocker / major / minor).
4. The test data you created (QA- names and IDs), so it can be found or cleaned up.

Do not mark something as passed unless you saw the result yourself.
