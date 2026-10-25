CREATE OR REPLACE PACKAGE library_pkg AS
    FUNCTION calculate_fine(
        p_due_date    IN DATE,
        p_return_date IN DATE
    ) RETURN NUMBER;

    PROCEDURE issue_book(
        p_book_id   IN NUMBER,
        p_member_id IN NUMBER
    );

    PROCEDURE return_book(
        p_issue_id IN NUMBER
    );

    PROCEDURE list_low_stock_books;
END library_pkg;
/

CREATE OR REPLACE PACKAGE BODY library_pkg AS
    c_fine_per_day CONSTANT NUMBER := 5;

    FUNCTION calculate_fine(
        p_due_date    IN DATE,
        p_return_date IN DATE
    ) RETURN NUMBER IS
        l_overdue_days NUMBER;
    BEGIN
        IF p_due_date IS NULL OR p_return_date IS NULL THEN
            RAISE_APPLICATION_ERROR(-20001, 'Due date and return date are required.');
        END IF;

        l_overdue_days := GREATEST(TRUNC(p_return_date) - TRUNC(p_due_date), 0);
        RETURN l_overdue_days * c_fine_per_day;
    END calculate_fine;

    PROCEDURE issue_book(
        p_book_id   IN NUMBER,
        p_member_id IN NUMBER
    ) IS
        l_available_copies books.available_copies%TYPE;
        l_member_status    members.status%TYPE;
        l_existing_issue   NUMBER;
        l_issue_date       DATE := TRUNC(SYSDATE);
    BEGIN
        -- Lock stock before checking it so concurrent checkouts cannot oversell.
        BEGIN
            SELECT available_copies
            INTO l_available_copies
            FROM books
            WHERE book_id = p_book_id
            FOR UPDATE;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20002, 'Book does not exist.');
        END;

        BEGIN
            SELECT status
            INTO l_member_status
            FROM members
            WHERE member_id = p_member_id;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20003, 'Member does not exist.');
        END;

        IF l_member_status <> 'ACTIVE' THEN
            RAISE_APPLICATION_ERROR(-20004, 'Member is not active.');
        END IF;

        SELECT COUNT(*)
        INTO l_existing_issue
        FROM book_issues
        WHERE book_id = p_book_id
          AND member_id = p_member_id
          AND status = 'ACTIVE';

        IF l_existing_issue > 0 THEN
            RAISE_APPLICATION_ERROR(-20005, 'Member already has this book issued.');
        END IF;

        IF l_available_copies <= 0 THEN
            RAISE_APPLICATION_ERROR(-20006, 'No copies are currently available.');
        END IF;

        INSERT INTO book_issues (book_id, member_id, issue_date, due_date, status, fine_amount)
        VALUES (p_book_id, p_member_id, l_issue_date, l_issue_date + 14, 'ACTIVE', 0);

        UPDATE books
        SET available_copies = available_copies - 1
        WHERE book_id = p_book_id;
    END issue_book;

    PROCEDURE return_book(
        p_issue_id IN NUMBER
    ) IS
        l_book_id     book_issues.book_id%TYPE;
        l_due_date    book_issues.due_date%TYPE;
        l_status      book_issues.status%TYPE;
        l_fine_amount book_issues.fine_amount%TYPE;
    BEGIN
        -- Lock the issue row so a concurrent duplicate return cannot restore stock twice.
        BEGIN
            SELECT book_id, due_date, status
            INTO l_book_id, l_due_date, l_status
            FROM book_issues
            WHERE issue_id = p_issue_id
            FOR UPDATE;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20007, 'Issue record does not exist.');
        END;

        IF l_status <> 'ACTIVE' THEN
            RAISE_APPLICATION_ERROR(-20008, 'This book has already been returned.');
        END IF;

        l_fine_amount := calculate_fine(l_due_date, TRUNC(SYSDATE));

        UPDATE book_issues
        SET status = 'RETURNED',
            return_date = TRUNC(SYSDATE),
            fine_amount = l_fine_amount
        WHERE issue_id = p_issue_id;

        UPDATE books
        SET available_copies = available_copies + 1
        WHERE book_id = l_book_id;
    END return_book;

    PROCEDURE list_low_stock_books IS
        -- Explicit cursor demonstrates declaration, open, fetch, and close.
        CURSOR c_low_stock IS
            SELECT book_id, title, available_copies, low_stock_threshold
            FROM books
            WHERE available_copies <= low_stock_threshold
            ORDER BY title;
        l_book c_low_stock%ROWTYPE;
    BEGIN
        OPEN c_low_stock;
        LOOP
            FETCH c_low_stock INTO l_book;
            EXIT WHEN c_low_stock%NOTFOUND;
            DBMS_OUTPUT.PUT_LINE(
                l_book.book_id || ' | ' || l_book.title || ' | available=' ||
                l_book.available_copies || ' | threshold=' || l_book.low_stock_threshold
            );
        END LOOP;
        CLOSE c_low_stock;
    EXCEPTION
        WHEN OTHERS THEN
            IF c_low_stock%ISOPEN THEN
                CLOSE c_low_stock;
            END IF;
            RAISE;
    END list_low_stock_books;
END library_pkg;
/

-- Compatibility wrappers make the required procedure names callable directly too.
CREATE OR REPLACE PROCEDURE issue_book(
    p_book_id IN NUMBER,
    p_member_id IN NUMBER
) AS
BEGIN
    library_pkg.issue_book(p_book_id, p_member_id);
END issue_book;
/

CREATE OR REPLACE PROCEDURE return_book(
    p_issue_id IN NUMBER
) AS
BEGIN
    library_pkg.return_book(p_issue_id);
END return_book;
/

CREATE OR REPLACE TRIGGER trg_book_issues_audit
AFTER INSERT OR UPDATE OF status ON book_issues
FOR EACH ROW
BEGIN
    IF INSERTING AND :NEW.status = 'ACTIVE' THEN
        INSERT INTO audit_log (issue_id, action_name, details)
        VALUES (:NEW.issue_id, 'ISSUE', 'Book issued to member ' || :NEW.member_id);
    ELSIF UPDATING AND :OLD.status = 'ACTIVE' AND :NEW.status = 'RETURNED' THEN
        INSERT INTO audit_log (issue_id, action_name, details)
        VALUES (
            :NEW.issue_id,
            'RETURN',
            'Book returned; fine=' || TO_CHAR(:NEW.fine_amount, 'FM999999990.00')
        );
    END IF;
END;
/
