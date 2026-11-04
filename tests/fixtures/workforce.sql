-- Synthetic accounts only. Apply after bootstrap to an EMPTY, disposable DB.
-- Password hashes are copied from the synthetic OWNER, never a developer DB.
INSERT INTO branches (id, code, name, address, status) VALUES
  (1,'QA-ONE','QA One','Synthetic','ACTIVE'),
  (2,'QA-TWO','QA Two','Synthetic','ACTIVE'),
  (3,'QA-STOP','QA Stopped','Synthetic','SUSPENDED');
INSERT INTO employees (id,email,password_hash,name,nickname,status)
  SELECT 2,'manager@workforce.test',password_hash,'QA Manager','manager','ACTIVE' FROM employees WHERE id=1;
INSERT INTO employees (id,email,password_hash,name,nickname,status)
  SELECT 3,'staff@workforce.test',password_hash,'QA Staff','staff','ACTIVE' FROM employees WHERE id=1;
INSERT INTO employees (id,email,password_hash,name,nickname,status)
  SELECT 4,'other@workforce.test',password_hash,'QA Other','other','ACTIVE' FROM employees WHERE id=1;
INSERT INTO branch_memberships (employee_id,branch_id,role,status) VALUES
  (1,1,'MANAGER','ACTIVE'),(2,1,'MANAGER','ACTIVE'),(2,2,'STAFF','ACTIVE'),
  (2,3,'MANAGER','ACTIVE'),(3,1,'STAFF','ACTIVE'),(3,2,'STAFF','ACTIVE'),
  (3,3,'STAFF','ACTIVE'),(4,1,'STAFF','ACTIVE');
