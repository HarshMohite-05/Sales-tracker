# Nirmaan WaterTech Solutions CRM Web Application

A fullstack Customer Relationship Management (CRM) web application purpose-built for **Nirmaan WaterTech Solutions** (Industrial & Commercial Water and Wastewater Treatment Systems).

This application completely replaces the legacy 6-sheet Excel workbook with one unified, interconnected platform featuring server-side role-based access control, background reminder processing, quotation versioning with PDF generation, milestone collections, and deterministic incentive calculations.

---

## 1. Key Highlights & Features

- **Exactly Two Roles**:
  - `DIRECTOR`: Company-wide visibility, quotation approvals, receipt verification, target setting, incentive approvals, and user management. (Accounts: Rajesh Sharma, Vikram Mehta).
  - `SALESPERSON`: Isolated access to assigned records, combined 16-field client creation, activity logging, follow-up execution, quotation drafting, and receipt submission.
- **Strict Follow-up Ownership Rule**:
  - All customer follow-ups are performed exclusively by salespeople. Overdue delays escalate alerts to both directors while keeping the task assigned to the responsible salesperson.
- **Combined 16-Field Add Client Tracker**:
  - Section A (Client Details), Section B (Requirement & Discussion), Section C (Next Follow-up), plus collapsed commercial details. Includes duplicate warnings, "Save Client Only" vs "Save Client & Follow-up".
- **Multiple Independent Enquiries per Client**:
  - A client profile supports multiple simultaneous requirements (e.g. RO Plant AMC + EDI System Supply), each with independent stages, quotations, and outcomes.
- **Background Worker & Notifications**:
  - Background worker (`npm run worker`) running every minute. Alerts the salesperson 30 minutes before each follow-up and when it falls due, sends everyone a morning summary at the time they choose (Settings), tells directors about every update (the kinds each director picks also buzz their phone), escalates overdue items to directors after 24h, and cancels obsolete notifications. Notifications appear in the bell and, once turned on in Settings, as phone (web push) notifications. Idempotent execution prevents duplicates.
- **Proposals & Quotations with PDF Generation**:
  - Version history (R0, R1...), immutable frozen versions, Director approval workflow for discounts > 3%, and one-click official PDF proposal generation.
- **Orders, Invoices & Receipt Verification**:
  - Order conversion from accepted quotes, milestone billing, partial payments, and two-step collection verification (salesperson submits, director verifies).
- **Quarterly Targets & Incentives (April - March Indian FY)**:
  - FY 2026-27 Q1, Q2, Q3, Q4 targets. Actual achievement attributed on exact matching event dates (June order paid in July is Q1 order, Q2 collection).
  - Configurable incentive policy supporting flat total rates or tiered marginal slabs with double-payout prevention.
- **Management Reporting & Excel Migration**:
  - 6+ interactive management reports with instant Excel (`.xlsx`) export.
  - 6-sheet Excel Import Wizard with duplicate batch detection and provenance tracking.

---

## 2. Tech Stack

- **Framework**: Next.js 15 (App Router) with TypeScript
- **Styling**: Tailwind CSS (Navy Blue `#0f172a`, pale grey `#f8fafc`, sky blue, teal accents)
- **Database**: PostgreSQL 16 (Relational DB)
- **ORM**: Prisma ORM 6.4.1
- **Authentication**: JWT Sessions via `jose` with secure HTTP-only cookies & `bcryptjs`
- **PDF Generation**: `jspdf` & `jspdf-autotable`
- **Spreadsheets**: `xlsx`
- **Background Worker**: Node.js worker with `node-cron` and `nodemailer`
- **Testing**: Vitest 5.0.5 (22/22 tests passing)

---

## 3. Quick Start (Local Setup)

### 1. Start PostgreSQL (Docker)
```bash
docker run -d --name nirmaan-postgres \
  -e POSTGRES_USER=nirmaan \
  -e POSTGRES_PASSWORD=nirmaan_secret \
  -e POSTGRES_DB=nirmaan_crm \
  -p 5432:5432 postgres:16-alpine
```

### 2. Configure Environment
```bash
cp .env.example .env
```

### 3. Synchronize Schema and Seed
```bash
npx prisma db push
npm run seed
```
The seed loads four fully linked sample clients (TWSPL, CLL, RTM, SGACPL): requirements, conversations,
follow-ups, quotations, orders, invoices and payments. It can be re-run at any time: it replaces only
those sample clients and never touches other clients or existing users' passwords.

To check that all records link up correctly (any database):
```bash
npm run check:links
```

### 4. Start Next.js Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5. Start Background Reminder Worker (In separate terminal)
```bash
npm run worker
```

---

## 4. Default Seeded Credentials

| Role | Name | Email | Password |
| :--- | :--- | :--- | :--- |
| **Director 1** | Rajesh Sharma | `rajesh.sharma@nirmaanwater.com` | `Nirmaan@2026` |
| **Director 2** | Vikram Mehta | `vikram.mehta@nirmaanwater.com` | `Nirmaan@2026` |
| **Sales Engineer** | Amit Patil | `amit.patil@nirmaanwater.com` | `Nirmaan@2026` |
| **Key Account Mgr**| Sneha Kulkarni | `sneha.kulkarni@nirmaanwater.com` | `Nirmaan@2026` |
| **OEM Sales** | Rahul Deshmukh | `rahul.deshmukh@nirmaanwater.com` | `Nirmaan@2026` |


---

## 5. Automated Tests

Run the full automated test suite covering all 22 acceptance criteria:
```bash
npm test
```
Tests use their own database (`DATABASE_URL` with `_test` added to the name, or `TEST_DATABASE_URL`).
Each run wipes that test database, loads the sample data, runs the link checks, then the tests.
They never touch the real CRM database.

---

## 6. Docker Production Deployment

Run everything (App, Database, Background Worker) via Docker Compose:
```bash
docker compose up -d --build
```
Access the application on port 3000. Refer to [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment, backup, and restore procedures.
