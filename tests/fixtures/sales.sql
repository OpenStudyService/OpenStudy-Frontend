-- Synthetic accounts only. Apply after OWNER bootstrap to an EMPTY disposable DB.
INSERT INTO branches (id, code, name, address, status) VALUES
  (1,'SALES-ONE','Sales One','Synthetic','ACTIVE'),
  (2,'SALES-TWO','Sales Two','Synthetic','ACTIVE');
INSERT INTO employees (id,email,password_hash,name,nickname,status)
  SELECT 3,'reader@sales.test',password_hash,'Sales Reader','reader','ACTIVE' FROM employees WHERE id=1;
INSERT INTO employees (id,email,password_hash,name,nickname,status)
  SELECT 4,'staff@sales.test',password_hash,'No Sales','staff','ACTIVE' FROM employees WHERE id=1;
INSERT INTO branch_memberships (employee_id,branch_id,role,status) VALUES
  (3,1,'STAFF','ACTIVE'),(3,2,'STAFF','ACTIVE'),(4,1,'STAFF','ACTIVE');
INSERT INTO membership_permission_grants (membership_id,permission_id)
  SELECT m.id,p.id FROM branch_memberships m CROSS JOIN permission_definitions p
  WHERE m.employee_id=3 AND m.branch_id=1 AND p.code='sales:read';
