-- Add the starter records only when they are not already present.
-- Books start with all copies available; issue records are created by the app
-- through LIBRARY_PKG so stock and audit history stay consistent.

MERGE INTO books target
USING (
    SELECT 'The Pragmatic Programmer' title,
           'David Thomas and Andrew Hunt' author,
           'Technology' category,
           42.50 price,
           5 total_copies,
           2 low_stock_threshold
    FROM dual
) source
ON (target.title = source.title AND target.author = source.author)
WHEN NOT MATCHED THEN
    INSERT (title, author, category, price, total_copies, available_copies, low_stock_threshold)
    VALUES (source.title, source.author, source.category, source.price,
            source.total_copies, source.total_copies, source.low_stock_threshold);

MERGE INTO books target
USING (
    SELECT 'Clean Code' title,
           'Robert C. Martin' author,
           'Technology' category,
           38.00 price,
           3 total_copies,
           2 low_stock_threshold
    FROM dual
) source
ON (target.title = source.title AND target.author = source.author)
WHEN NOT MATCHED THEN
    INSERT (title, author, category, price, total_copies, available_copies, low_stock_threshold)
    VALUES (source.title, source.author, source.category, source.price,
            source.total_copies, source.total_copies, source.low_stock_threshold);

MERGE INTO books target
USING (
    SELECT 'The Alchemist' title,
           'Paulo Coelho' author,
           'Fiction' category,
           16.99 price,
           4 total_copies,
           1 low_stock_threshold
    FROM dual
) source
ON (target.title = source.title AND target.author = source.author)
WHEN NOT MATCHED THEN
    INSERT (title, author, category, price, total_copies, available_copies, low_stock_threshold)
    VALUES (source.title, source.author, source.category, source.price,
            source.total_copies, source.total_copies, source.low_stock_threshold);

MERGE INTO books target
USING (
    SELECT 'Introduction to Algorithms' title,
           'Thomas H. Cormen' author,
           'Technology' category,
           74.00 price,
           2 total_copies,
           1 low_stock_threshold
    FROM dual
) source
ON (target.title = source.title AND target.author = source.author)
WHEN NOT MATCHED THEN
    INSERT (title, author, category, price, total_copies, available_copies, low_stock_threshold)
    VALUES (source.title, source.author, source.category, source.price,
            source.total_copies, source.total_copies, source.low_stock_threshold);

MERGE INTO members target
USING (
    SELECT 'Aarav Sharma' full_name,
           'aarav@example.edu' email,
           '+91 98765 43210' phone
    FROM dual
) source
ON (target.email = source.email)
WHEN NOT MATCHED THEN
    INSERT (full_name, email, phone, status)
    VALUES (source.full_name, source.email, source.phone, 'ACTIVE');

MERGE INTO members target
USING (
    SELECT 'Maya Patel' full_name,
           'maya@example.edu' email,
           '+91 98765 43211' phone
    FROM dual
) source
ON (target.email = source.email)
WHEN NOT MATCHED THEN
    INSERT (full_name, email, phone, status)
    VALUES (source.full_name, source.email, source.phone, 'ACTIVE');

MERGE INTO members target
USING (
    SELECT 'Rohan Das' full_name,
           'rohan@example.edu' email,
           '+91 98765 43212' phone
    FROM dual
) source
ON (target.email = source.email)
WHEN NOT MATCHED THEN
    INSERT (full_name, email, phone, status)
    VALUES (source.full_name, source.email, source.phone, 'INACTIVE');

COMMIT;
