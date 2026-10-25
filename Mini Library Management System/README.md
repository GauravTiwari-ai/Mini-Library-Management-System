# Mini Library Management System

A responsive HTML/CSS/vanilla-JavaScript library website using Oracle Database and PL/SQL, with a small Python API connector. **Oracle owns the library data and business rules**: the Python process only translates browser requests into Oracle SQL/PL/SQL calls. It does not replace Oracle or the PL/SQL syllabus features. The project uses no Java, JDBC, Servlets, Tomcat, PHP, MySQL, or SQLite.

## Folder structure

```text
Mini Library Management System/
├── backend/
│   └── server.py
├── database/
│   ├── 01_schema.sql
│   ├── 02_plsql_packages.sql
│   └── 03_sample_data.sql
├── src/main/resources/web/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── requirements.txt
└── README.md
```

## Requirements

- Oracle Database 12c or newer, with a service such as `FREEPDB1` (Oracle Free).
- Python 3.9 or newer.
- VS Code Live Server (configured in this workspace for port `5501`) or a browser.
- The Python package in `requirements.txt` (`python-oracledb`, using its default Thin mode; no Oracle Instant Client required).

A browser cannot safely or natively connect to Oracle SQL*Net. For Oracle mode, run the local Python connector and select **Oracle database** in the frontend. The connector uses the Oracle driver for data queries and leaves issue, return, fine, and audit rules in PL/SQL. No data is silently substituted when Oracle mode fails.

## Set up Oracle objects

1. Start Oracle Database and confirm the pluggable database/service is open. For Oracle Free, the usual service is `FREEPDB1`; for XE it is often `XEPDB1`.
2. In SQL Developer, connect as an administrator such as `SYSTEM` and create a dedicated application schema. Replace the password with one you choose:

   ```sql
   CREATE USER LIBRARY_APP IDENTIFIED BY "choose_a_strong_password";
   GRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE, CREATE PROCEDURE, CREATE TRIGGER TO LIBRARY_APP;
   ALTER USER LIBRARY_APP QUOTA 100M ON USERS;
   ```

   Do not use `SYSTEM` as the application account.
3. Connect SQL Developer as `LIBRARY_APP` and run these scripts in order using **Run Script (F5)**:
   - `database/01_schema.sql`
   - `database/02_plsql_packages.sql`
   - `database/03_sample_data.sql`
4. The scripts define the schema expected by `backend/server.py`, `LIBRARY_PKG`, the top-level `ISSUE_BOOK`/`RETURN_BOOK` wrappers, and the issue audit trigger. Run `01_schema.sql` only for a new/empty application schema; it creates tables and is not a migration script. The sample-data script adds starter books and members only when they are missing and commits its rows. It does not overwrite existing book/member edits or create issues.

## Install and run the Python connector

Open a PowerShell terminal in the project root. A virtual environment avoids requiring administrator permissions:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Run the included `run.ps1` from the project root:

```powershell
.\run.ps1
```

On first run, enter the service DSN, schema username, and password at the secure prompt. The password is encrypted for your Windows account and stored under `%LOCALAPPDATA%\MiniLibrary`; it is not written into project files. Later runs reuse those credentials automatically. To update them, run `.\run.ps1 -Configure`. The script uses the project's `.venv` Python when available. Keep the terminal running; the API listens only on this computer at `http://127.0.0.1:8080`.

Check the Oracle connection and project schema in the browser at `http://127.0.0.1:8080/api/health`. A ready database returns `"status":"ok"` and `"schemaReady":true`; missing or invalid tables/procedures/triggers are listed in the response. The frontend also provides a **Test Oracle** button when Oracle mode is selected.

## Open the website

- **Recommended with VS Code Go Live:** start the Python server above, then click **Go Live**. On a fresh browser, the frontend checks the API and automatically selects Oracle mode when the library schema is ready. With the workspace Live Server port `5501`, Oracle mode sends API requests to `127.0.0.1:8080`. The API also allows its own local website origins on port `8080`; other origins are rejected.
- **Serve both app and API from Python:** while the Python connector is running, open `http://127.0.0.1:8080`.
- **Frontend preview only:** choose **Demo mode**. It works in a browser or Go Live without Oracle or the Python process; demo edits are saved in browser `localStorage` and are not sent to the database.

Choose **Oracle database** only after the Python process is running and the Oracle scripts have been installed. On startup, if a previously selected Oracle connection or schema is unavailable, the page switches to Demo mode and displays an informational notice; demo edits remain in this browser and are not sent to Oracle. If an Oracle data request fails after startup, the page shows an error rather than substituting demo data.

### Connection troubleshooting

- **“The Python API was not found” / 404:** start `python backend\server.py`; do not use Go Live as the API server.
- **Python reports that `oracledb` is missing:** activate the project `.venv` and run `python -m pip install -r requirements.txt` there. Installing the package does not install or start Oracle Database.
- **“Set ORACLE_DSN…”:** start with `.\run.ps1`; configure the saved login with `.\run.ps1 -Configure` if needed.
- **“Could not connect to Oracle”:** confirm the Oracle listener and database service are running, verify the service name in SQL Developer, and enter that same host/port/service in the DSN (for example, `localhost:1521/FREEPDB1`). Also confirm the schema username and password.
- **“Table or view does not exist” / invalid identifier:** connect as the project schema and rerun the database scripts in order.
- The VS Code SQL Developer connection profile is separate from the Python process: saving a profile does not pass its credentials to this app. The `SYSTEM` login shown in SQL Developer should only create the app schema; run the application using `LIBRARY_APP`.

The database will not work if any part of this chain is missing: Oracle must be installed and running; the service DSN must point to an open database service; all three SQL scripts must have been run in the same schema used by the API; `python-oracledb` must be installed in the Python environment that starts the server; and `run.ps1` must receive that schema's credentials. Running only the HTML page or a static web server starts neither Oracle nor the Python API. Use **Demo mode** for a frontend-only preview; it does not read or write Oracle data.

## Features

- Dashboard: total book copies, registered members, active issues, and overdue issues.
- Books: add, edit, delete, search, and view copies and stock status.
- Members: register, search, edit contact details/status, and delete.
- Circulation: validate and issue books, prevent duplicates/out-of-stock issues, and return books.
- Reports: low stock, active issues, overdue issues, recent audit activity.
- Confirmation for destructive actions, status/error messages, responsive layout, and offline demo.

## PL/SQL viva notes

The scripts define `LIBRARY_PKG` in `02_plsql_packages.sql`.

- `list_low_stock_books` uses an **explicit cursor** and `DBMS_OUTPUT` to list books at or below their stock threshold.
- `calculate_fine(due_date, return_date)` is a **user-defined function**. The documented policy is 5 currency units per overdue calendar day.
- `issue_book(book_id, member_id)` locks and validates the book/member, rejects unavailable stock and duplicate active issues, inserts an issue, and decrements stock.
- `return_book(issue_id)` locks and validates the issue, calculates the fine, marks it returned, and restores stock.
- `TRG_BOOK_ISSUES_AUDIT` records issue/return changes in `AUDIT_LOG`.
- The procedures do not commit. The Python connector commits after successful calls and rolls back errors, so issue/stock/audit changes stay atomic.

Direct PL/SQL examples:

```sql
SET SERVEROUTPUT ON;
BEGIN
  LIBRARY_PKG.list_low_stock_books;
END;
/

SELECT LIBRARY_PKG.calculate_fine(TRUNC(SYSDATE) - 5, TRUNC(SYSDATE)) AS fine
FROM dual;

BEGIN
  LIBRARY_PKG.issue_book(1, 1);
  COMMIT;
END;
/
```

Python-to-PL/SQL examples used by the connector:

```python
with connection.cursor() as cursor:
    cursor.callproc("ISSUE_BOOK", [book_id, member_id])
connection.commit()
```

```python
with connection.cursor() as cursor:
    cursor.callproc("RETURN_BOOK", [issue_id])
connection.commit()
```

```python
with connection.cursor() as cursor:
    fine = cursor.callfunc(
        "LIBRARY_PKG.CALCULATE_FINE",
        oracledb.NUMBER,
        [due_date, return_date],
    )
```

The issue/return and audit rules remain inside Oracle PL/SQL; Python does not reimplement them.

## Test checklist

- [ ] Low stock: verify the report and `LIBRARY_PKG.list_low_stock_books`.
- [ ] Invalid member: issue to a nonexistent ID; verify no issue or stock change.
- [ ] Out of stock: issue the last copy and try again; verify stock never becomes negative.
- [ ] Successful issue: check `BOOK_ISSUES`, reduced availability, and an `ISSUE` audit row.
- [ ] Duplicate active issue: issue the same book/member pair twice; verify rejection.
- [ ] Successful return: verify issue status/date, restored copies, and a `RETURN` audit row.
- [ ] Overdue fine: test `calculate_fine` or return an overdue issue; verify 5 per overdue day.
- [ ] Invalid return: return an already-returned issue; verify rejection and unchanged stock.
- [ ] Database failure: verify rollback preserves issue, stock, and audit consistency.

## Project report outline

1. Title page, certificate, acknowledgement, abstract.
2. Problem statement, objectives, scope, and proposed system.
3. Technology and architecture (HTML/CSS/JS, Python Oracle connector, Oracle PL/SQL).
4. Data flow: browser → local Python connector → Oracle; explain that PL/SQL owns transaction rules.
5. ER model and table/constraint/index design.
6. UI/API operations and screenshots.
7. Package, explicit cursor, function, procedures, trigger, exception, and transaction concepts.
8. Test cases/results, limitations, security, future improvements, conclusion, and references.

## Viva Q&A

**Does Python replace Oracle or PL/SQL here?**  
No. Python is a local connector between the browser and Oracle. Oracle stores the records and runs the issue/return procedures, fine function, and audit trigger.

**Why can’t frontend JavaScript connect directly to Oracle?**  
Browsers do not provide Oracle's database protocol or safe storage for database credentials. A local connector keeps credentials outside browser code and forwards requests to Oracle.

**How does the application prevent two checkouts from overselling a copy?**  
The PL/SQL issue procedure locks the book row with `FOR UPDATE` before checking/decrementing available copies.

**Why is there no commit in the PL/SQL procedure?**  
The caller owns the transaction. Python commits only after success and rolls back on failure; trigger audit rows participate in the same Oracle transaction.

**How is the fine calculated?**  
`LIBRARY_PKG.calculate_fine` multiplies overdue calendar days by 5 and returns zero for early/on-time returns.

**What does demo mode do?**  
It uses sample data stored in the browser. It is only a preview and does not connect to Oracle.
