-- Apply ONLY to the fresh disposable DB, after workforce.sql.
INSERT INTO employees (id,email,password_hash,name,nickname,status)
  SELECT 5,'cleanup@workforce.test',password_hash,'QA Cleanup','cleanup','ACTIVE' FROM employees WHERE id=1;
INSERT INTO branch_memberships (employee_id,branch_id,role,status) VALUES
  (4,2,'STAFF','ACTIVE'),(5,1,'STAFF','ACTIVE'),(5,3,'STAFF','ACTIVE');
-- Historical synthetic timing fixture: the Backend computes 498, never the UI.
INSERT INTO attendance_records (id,employee_id,branch_id,clock_in_at,clock_out_at,status)
  VALUES (9001,3,1,'2026-11-01 00:00:00','2026-11-01 09:00:00','LEFT');
INSERT INTO attendance_breaks (attendance_id,started_at,ended_at) VALUES
  (9001,'2026-11-01 03:00:00','2026-11-01 03:30:30'),
  (9001,'2026-11-01 06:00:00','2026-11-01 06:10:45');
