from __future__ import annotations

import json
import math
import os
import re
import sys
from datetime import date, datetime
from decimal import Decimal
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

try:
    import oracledb
except ImportError as error:
    raise SystemExit(
        "Oracle driver is missing. Install dependencies with "
        "'python -m pip install -r requirements.txt'."
    ) from error


PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEB_ROOT = PROJECT_ROOT / "src" / "main" / "resources" / "web"
ALLOWED_ORIGINS = {
    "http://localhost:5501",
    "http://127.0.0.1:5501",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
}
MAX_BODY_SIZE = 1_000_000


class ApiError(Exception):
    def __init__(self, status: HTTPStatus, message: str) -> None:
        super().__init__(message)
        self.status = status


def oracle_dsn() -> str:
    dsn = os.getenv("ORACLE_DSN", "").strip()
    if dsn:
        return dsn

    jdbc_url = os.getenv("ORACLE_JDBC_URL", "").strip()
    match = re.fullmatch(r"jdbc:oracle:thin:@//([^/]+/[^/]+)", jdbc_url)
    if match:
        return match.group(1)
    if jdbc_url:
        raise ApiError(
            HTTPStatus.SERVICE_UNAVAILABLE,
            "Use ORACLE_DSN such as localhost:1521/FREEPDB1. "
            "Only JDBC service-name URLs can be converted automatically.",
        )
    raise ApiError(
        HTTPStatus.SERVICE_UNAVAILABLE,
        "Set ORACLE_DSN, ORACLE_USER, and ORACLE_PASSWORD before starting the app.",
    )


def connect_oracle():
    username = os.getenv("ORACLE_USER", "").strip()
    password = os.getenv("ORACLE_PASSWORD", "")
    if not username or not password:
        raise ApiError(
            HTTPStatus.SERVICE_UNAVAILABLE,
            "Set ORACLE_DSN, ORACLE_USER, and ORACLE_PASSWORD before starting the app.",
        )
    try:
        return oracledb.connect(user=username, password=password, dsn=oracle_dsn())
    except ApiError:
        raise
    except oracledb.Error as error:
        print(f"Oracle connection failed: {error}", file=sys.stderr)
        raise ApiError(
            HTTPStatus.SERVICE_UNAVAILABLE,
            "Could not connect to Oracle. Check that the database is running and "
            "ORACLE_DSN, ORACLE_USER, and ORACLE_PASSWORD are correct.",
        ) from error


def json_value(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    if isinstance(value, date):
        return value.isoformat()
    raise TypeError(f"Cannot encode {type(value).__name__} as JSON")


def query_rows(sql: str, binds: dict | None = None) -> list[dict]:
    with connect_oracle() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, binds or {})
            columns = [column[0].lower() for column in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]


def run_transaction(work):
    with connect_oracle() as connection:
        try:
            result = work(connection)
            connection.commit()
            return result
        except Exception:
            connection.rollback()
            raise


def read_json(handler: BaseHTTPRequestHandler) -> dict:
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError as error:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid request body length.") from error
    if length <= 0 or length > MAX_BODY_SIZE:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Request body is empty or too large.")
    try:
        payload = json.loads(handler.rfile.read(length))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Request body contains invalid JSON.") from error
    if not isinstance(payload, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Request body must be a JSON object.")
    return payload


def required_text(payload: dict, name: str) -> str:
    value = payload.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ApiError(HTTPStatus.BAD_REQUEST, f"{name} is required.")
    return value.strip()


def non_negative_int(payload: dict, name: str) -> int:
    value = payload.get(name)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ApiError(HTTPStatus.BAD_REQUEST, f"{name} must be a non-negative whole number.")
    return value


def positive_id(value: str, label: str = "ID") -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise ApiError(HTTPStatus.BAD_REQUEST, f"{label} must be a positive integer.") from error
    if parsed <= 0:
        raise ApiError(HTTPStatus.BAD_REQUEST, f"{label} must be a positive integer.")
    return parsed


def oracle_error(error: Exception) -> ApiError:
    detail = error.args[0] if error.args else None
    code = getattr(detail, "code", getattr(error, "code", None))
    message = str(error)
    custom_error = re.search(r"ORA-(20\d{3}):\s*([^\r\n]+)", message)
    if custom_error:
        return ApiError(HTTPStatus.BAD_REQUEST, custom_error.group(2).strip())
    if code == 1:
        return ApiError(HTTPStatus.CONFLICT, "A record with one of these unique values already exists.")
    if code == 2292:
        return ApiError(HTTPStatus.CONFLICT, "This record cannot be deleted because issue history references it.")
    if code == 2291:
        return ApiError(HTTPStatus.BAD_REQUEST, "The selected book or member does not exist.")
    print(f"Oracle request failed: {message}", file=sys.stderr)
    oracle_code = re.search(r"(ORA-\d{5}):\s*([^\r\n]+)", message)
    if oracle_code:
        code_name, detail_message = oracle_code.groups()
        return ApiError(
            HTTPStatus.INTERNAL_SERVER_ERROR,
            f"Oracle error {code_name}: {detail_message.strip()}",
        )
    return ApiError(HTTPStatus.INTERNAL_SERVER_ERROR, "Database request failed. Check the server console.")


class LibraryHandler(BaseHTTPRequestHandler):
    server_version = "MiniLibraryPython/1.0"

    def do_GET(self) -> None:
        self.handle_request()

    def do_POST(self) -> None:
        self.handle_request()

    def do_PUT(self) -> None:
        self.handle_request()

    def do_DELETE(self) -> None:
        self.handle_request()

    def do_OPTIONS(self) -> None:
        if not self.path.startswith("/api/"):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        origin = self.headers.get("Origin")
        if origin is not None and origin not in ALLOWED_ORIGINS:
            self.send_json(HTTPStatus.FORBIDDEN, {"error": "This website origin is not allowed."})
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.add_cors_headers()
        self.end_headers()

    def log_message(self, format_string: str, *args) -> None:
        print(f"{self.address_string()} - {format_string % args}")

    def handle_request(self) -> None:
        try:
            parsed = urlsplit(self.path)
            if parsed.path.startswith("/api/"):
                result, status = self.handle_api(parsed.path, parse_qs(parsed.query))
                self.send_json(status, result)
            else:
                self.serve_static(parsed.path)
        except ApiError as error:
            self.send_json(error.status, {"error": str(error)})
        except oracledb.Error as error:
            mapped = oracle_error(error)
            self.send_json(mapped.status, {"error": str(mapped)})
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            print("Unexpected request failure:", file=sys.stderr)
            import traceback

            traceback.print_exc()
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "The request could not be completed."})

    def add_cors_headers(self) -> bool:
        origin = self.headers.get("Origin")
        if origin is None:
            return True
        if origin not in ALLOWED_ORIGINS:
            return False
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        return True

    def send_json(self, status: HTTPStatus, payload: object) -> None:
        origin = self.headers.get("Origin")
        if origin is not None and origin not in ALLOWED_ORIGINS:
            status = HTTPStatus.FORBIDDEN
            payload = {"error": "This website origin is not allowed."}
        body = json.dumps(payload, default=json_value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.add_cors_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_static(self, raw_path: str) -> None:
        if self.command not in {"GET", "HEAD"}:
            self.send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "Method not allowed."})
            return
        relative_path = unquote(raw_path).lstrip("/") or "index.html"
        requested = (WEB_ROOT / relative_path).resolve()
        if not requested.is_relative_to(WEB_ROOT.resolve()) or not requested.is_file():
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Page not found."})
            return
        content_types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
        }
        body = requested.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_types.get(requested.suffix, "application/octet-stream"))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def handle_api(self, path: str, query: dict[str, list[str]]) -> tuple[object, HTTPStatus]:
        method = self.command
        if path == "/api/health" and method == "GET":
            required_objects = {
                ("BOOKS", "TABLE"),
                ("MEMBERS", "TABLE"),
                ("BOOK_ISSUES", "TABLE"),
                ("AUDIT_LOG", "TABLE"),
                ("LIBRARY_PKG", "PACKAGE"),
                ("LIBRARY_PKG", "PACKAGE BODY"),
                ("ISSUE_BOOK", "PROCEDURE"),
                ("RETURN_BOOK", "PROCEDURE"),
                ("TRG_BOOK_ISSUES_AUDIT", "TRIGGER"),
            }
            with connect_oracle() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT 1 FROM dual")
                    cursor.fetchone()
                    cursor.execute(
                        "SELECT object_name, object_type, status FROM user_objects "
                        "WHERE object_name IN "
                        "('BOOKS', 'MEMBERS', 'BOOK_ISSUES', 'AUDIT_LOG', 'LIBRARY_PKG', "
                        "'ISSUE_BOOK', 'RETURN_BOOK', 'TRG_BOOK_ISSUES_AUDIT')"
                    )
                    actual_objects = {
                        (name, object_type): status
                        for name, object_type, status in cursor.fetchall()
                    }
            missing_objects = sorted(
                f"{object_type} {name}"
                for name, object_type in required_objects
                if actual_objects.get((name, object_type)) != "VALID"
            )
            if missing_objects:
                return {
                    "status": "connected",
                    "database": "Oracle",
                    "schemaReady": False,
                    "message": "Oracle is connected, but these objects are missing or invalid: "
                    + ", ".join(missing_objects)
                    + ". Run database/01_schema.sql and database/02_plsql_packages.sql as this schema user.",
                }, HTTPStatus.OK
            return {
                "status": "ok",
                "database": "Oracle",
                "schemaReady": True,
                "message": "Oracle connection and library objects are ready.",
            }, HTTPStatus.OK

        if path == "/api/dashboard" and method == "GET":
            rows = query_rows(
                "SELECT (SELECT NVL(SUM(total_copies), 0) FROM books) total_books, "
                "(SELECT COUNT(*) FROM members) registered_members, "
                "(SELECT COUNT(*) FROM book_issues WHERE status='ACTIVE') active_issues, "
                "(SELECT COUNT(*) FROM book_issues WHERE status='ACTIVE' "
                "AND due_date < TRUNC(SYSDATE)) overdue_books FROM dual"
            )
            row = rows[0]
            return {
                "totalBooks": row["total_books"],
                "registeredMembers": row["registered_members"],
                "activeIssues": row["active_issues"],
                "overdueBooks": row["overdue_books"],
            }, HTTPStatus.OK

        if path == "/api/books":
            return self.books(method, query)
        if path.startswith("/api/books/"):
            return self.book_record(method, path.removeprefix("/api/books/"))
        if path == "/api/members":
            return self.members(method, query)
        if path.startswith("/api/members/"):
            return self.member_record(method, path.removeprefix("/api/members/"))
        if path == "/api/issues":
            return self.issues(method, query)
        match = re.fullmatch(r"/api/issues/([^/]+)/return", path)
        if match and method == "POST":
            issue_id = positive_id(match.group(1), "Issue ID")

            def return_book(connection) -> None:
                with connection.cursor() as cursor:
                    cursor.callproc("RETURN_BOOK", [issue_id])

            run_transaction(return_book)
            return {"message": "Book returned successfully."}, HTTPStatus.OK

        if path == "/api/reports" and method == "GET":
            return self.report(query), HTTPStatus.OK

        if path == "/api/fines/preview" and method == "POST":
            payload = read_json(self)
            try:
                due_date = date.fromisoformat(required_text(payload, "dueDate"))
                return_date = date.fromisoformat(required_text(payload, "returnDate"))
            except ValueError as error:
                raise ApiError(HTTPStatus.BAD_REQUEST, "Dates must use YYYY-MM-DD format.") from error
            with connect_oracle() as connection:
                with connection.cursor() as cursor:
                    fine = cursor.callfunc(
                        "LIBRARY_PKG.CALCULATE_FINE",
                        oracledb.NUMBER,
                        [due_date, return_date],
                    )
            return {"fine": fine or 0}, HTTPStatus.OK

        raise ApiError(HTTPStatus.NOT_FOUND, "API endpoint not found.")

    def books(self, method: str, query: dict[str, list[str]]) -> tuple[object, HTTPStatus]:
        if method == "GET":
            search = query.get("search", [""])[0].strip().lower()
            pattern = f"%{search}%"
            rows = query_rows(
                "SELECT book_id, title, author, category, price, total_copies, available_copies, "
                "low_stock_threshold FROM books "
                "WHERE LOWER(title) LIKE :search_title OR LOWER(author) LIKE :search_author "
                "OR LOWER(category) LIKE :search_category ORDER BY title",
                {"search_title": pattern, "search_author": pattern, "search_category": pattern},
            )
            return rows, HTTPStatus.OK
        if method == "POST":
            payload = read_json(self)
            title = required_text(payload, "title")
            author = required_text(payload, "author")
            category = required_text(payload, "category")
            price = payload.get("price")
            if (isinstance(price, bool) or not isinstance(price, (int, float))
                    or not math.isfinite(price) or price < 0):
                raise ApiError(HTTPStatus.BAD_REQUEST, "price must be a non-negative number.")
            total = non_negative_int(payload, "totalCopies")
            threshold = non_negative_int(payload, "lowStockThreshold")
            available = payload.get("availableCopies", total)
            if isinstance(available, bool) or not isinstance(available, int) or not 0 <= available <= total:
                raise ApiError(HTTPStatus.BAD_REQUEST, "availableCopies must be between zero and totalCopies.")

            def insert_book(connection) -> None:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO books (title, author, category, price, total_copies, "
                        "available_copies, low_stock_threshold) "
                        "VALUES (:title, :author, :category, :price, :total, :available, :threshold)",
                        {"title": title, "author": author, "category": category, "price": price,
                         "total": total, "available": available, "threshold": threshold},
                    )

            run_transaction(insert_book)
            return {"message": "Book added."}, HTTPStatus.CREATED
        raise ApiError(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed for books.")

    def book_record(self, method: str, raw_id: str) -> tuple[object, HTTPStatus]:
        book_id = positive_id(raw_id, "Book ID")
        if method == "PUT":
            payload = read_json(self)
            title = required_text(payload, "title")
            author = required_text(payload, "author")
            category = required_text(payload, "category")
            price = payload.get("price")
            if (isinstance(price, bool) or not isinstance(price, (int, float))
                    or not math.isfinite(price) or price < 0):
                raise ApiError(HTTPStatus.BAD_REQUEST, "price must be a non-negative number.")
            total = non_negative_int(payload, "totalCopies")
            threshold = non_negative_int(payload, "lowStockThreshold")

            def update_book(connection) -> None:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "UPDATE books SET title=:title, author=:author, category=:category, price=:price, "
                        "total_copies=:total, available_copies=available_copies + (:total - total_copies), "
                        "low_stock_threshold=:threshold WHERE book_id=:book_id "
                        "AND :total >= (total_copies - available_copies)",
                        {"title": title, "author": author, "category": category, "price": price,
                         "total": total, "threshold": threshold, "book_id": book_id},
                    )
                    if cursor.rowcount == 0:
                        raise ApiError(
                            HTTPStatus.CONFLICT,
                            "Book not found or total copies are below the number currently issued.",
                        )

            run_transaction(update_book)
            return {"message": "Book updated."}, HTTPStatus.OK
        if method == "DELETE":
            def delete_book(connection) -> None:
                with connection.cursor() as cursor:
                    cursor.execute("DELETE FROM books WHERE book_id=:book_id", {"book_id": book_id})
                    if cursor.rowcount == 0:
                        raise ApiError(HTTPStatus.NOT_FOUND, "Book not found.")

            run_transaction(delete_book)
            return {"message": "Book deleted."}, HTTPStatus.OK
        raise ApiError(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed for books.")

    def members(self, method: str, query: dict[str, list[str]]) -> tuple[object, HTTPStatus]:
        if method == "GET":
            search = query.get("search", [""])[0].strip().lower()
            pattern = f"%{search}%"
            return query_rows(
                "SELECT member_id, full_name, email, phone, join_date, status FROM members "
                "WHERE LOWER(full_name) LIKE :name OR LOWER(email) LIKE :email "
                "OR LOWER(phone) LIKE :phone ORDER BY full_name",
                {"name": pattern, "email": pattern, "phone": pattern},
            ), HTTPStatus.OK
        if method == "POST":
            payload = read_json(self)
            name = required_text(payload, "fullName")
            email = required_text(payload, "email")
            phone = str(payload.get("phone") or "").strip()

            def insert_member(connection) -> None:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO members (full_name, email, phone) VALUES (:name, :email, :phone)",
                        {"name": name, "email": email, "phone": phone or None},
                    )

            run_transaction(insert_member)
            return {"message": "Member registered."}, HTTPStatus.CREATED
        raise ApiError(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed for members.")

    def member_record(self, method: str, raw_id: str) -> tuple[object, HTTPStatus]:
        member_id = positive_id(raw_id, "Member ID")
        if method == "PUT":
            payload = read_json(self)
            name = required_text(payload, "fullName")
            email = required_text(payload, "email")
            phone = str(payload.get("phone") or "").strip()
            status = str(payload.get("status", "ACTIVE")).upper()
            if status not in {"ACTIVE", "INACTIVE"}:
                raise ApiError(HTTPStatus.BAD_REQUEST, "Member status must be ACTIVE or INACTIVE.")

            def update_member(connection) -> None:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "UPDATE members SET full_name=:name, email=:email, phone=:phone, status=:status "
                        "WHERE member_id=:member_id",
                        {"name": name, "email": email, "phone": phone or None,
                         "status": status, "member_id": member_id},
                    )
                    if cursor.rowcount == 0:
                        raise ApiError(HTTPStatus.NOT_FOUND, "Member not found.")

            run_transaction(update_member)
            return {"message": "Member updated."}, HTTPStatus.OK
        if method == "DELETE":
            def delete_member(connection) -> None:
                with connection.cursor() as cursor:
                    cursor.execute("DELETE FROM members WHERE member_id=:member_id", {"member_id": member_id})
                    if cursor.rowcount == 0:
                        raise ApiError(HTTPStatus.NOT_FOUND, "Member not found.")

            run_transaction(delete_member)
            return {"message": "Member deleted."}, HTTPStatus.OK
        raise ApiError(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed for members.")

    def issues(self, method: str, query: dict[str, list[str]]) -> tuple[object, HTTPStatus]:
        if method == "GET":
            status = query.get("status", [""])[0].upper()
            if status and status not in {"ACTIVE", "RETURNED"}:
                raise ApiError(HTTPStatus.BAD_REQUEST, "Status must be ACTIVE or RETURNED.")
            sql = (
                "SELECT i.issue_id, i.book_id, b.title, i.member_id, m.full_name, i.issue_date, "
                "i.due_date, i.return_date, i.status, i.fine_amount FROM book_issues i "
                "JOIN books b ON b.book_id=i.book_id JOIN members m ON m.member_id=i.member_id "
            )
            binds = {}
            if status:
                sql += "WHERE i.status=:status "
                binds["status"] = status
            return query_rows(sql + "ORDER BY i.issue_date DESC", binds), HTTPStatus.OK
        if method == "POST":
            payload = read_json(self)
            book_id = positive_id(payload.get("bookId"), "Book ID")
            member_id = positive_id(payload.get("memberId"), "Member ID")

            def issue_book(connection) -> None:
                with connection.cursor() as cursor:
                    # The PL/SQL procedure validates the member and stock, then adjusts copies atomically.
                    cursor.callproc("ISSUE_BOOK", [book_id, member_id])

            run_transaction(issue_book)
            return {"message": "Book issued successfully."}, HTTPStatus.CREATED
        raise ApiError(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed for issues.")

    def report(self, query: dict[str, list[str]]) -> list[dict]:
        report_type = query.get("type", [""])[0]
        reports = {
            "low-stock": (
                "SELECT book_id, title, author, available_copies, low_stock_threshold FROM books "
                "WHERE available_copies <= low_stock_threshold ORDER BY title"
            ),
            "active": (
                "SELECT i.issue_id, b.title, m.full_name, i.issue_date, i.due_date "
                "FROM book_issues i JOIN books b ON b.book_id=i.book_id "
                "JOIN members m ON m.member_id=i.member_id WHERE i.status='ACTIVE' ORDER BY i.due_date"
            ),
            "overdue": (
                "SELECT i.issue_id, b.title, m.full_name, i.issue_date, i.due_date, "
                "TRUNC(SYSDATE)-TRUNC(i.due_date) overdue_days, "
                "(TRUNC(SYSDATE)-TRUNC(i.due_date))*5 estimated_fine "
                "FROM book_issues i JOIN books b ON b.book_id=i.book_id "
                "JOIN members m ON m.member_id=i.member_id "
                "WHERE i.status='ACTIVE' AND i.due_date < TRUNC(SYSDATE) ORDER BY i.due_date"
            ),
            "activity": (
                "SELECT a.audit_id, a.issue_id, a.action_name, a.action_time, a.details, b.title, m.full_name "
                "FROM audit_log a JOIN book_issues i ON i.issue_id=a.issue_id "
                "JOIN books b ON b.book_id=i.book_id JOIN members m ON m.member_id=i.member_id "
                "ORDER BY a.action_time DESC FETCH FIRST 50 ROWS ONLY"
            ),
        }
        if report_type not in reports:
            raise ApiError(HTTPStatus.BAD_REQUEST, "Unknown report type.")
        return query_rows(reports[report_type])


def main() -> None:
    port = int(os.getenv("PORT", "8080"))
    server = ThreadingHTTPServer(("127.0.0.1", port), LibraryHandler)
    print(f"Mini Library Python API is running at http://localhost:{port}")
    print("Oracle database access is ready." if os.getenv("ORACLE_USER") else
          "Oracle credentials are not configured; set ORACLE_DSN, ORACLE_USER, and ORACLE_PASSWORD.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Mini Library API.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
