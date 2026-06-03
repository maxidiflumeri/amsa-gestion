# ============ RDS MySQL (privada) ============

resource "random_password" "db" {
  length  = 24
  special = false # alfanumérico → seguro dentro de DATABASE_URL
}

resource "aws_db_subnet_group" "main" {
  name       = "amsa-gestion-db"
  subnet_ids = data.aws_subnets.selected.ids
}

resource "aws_db_instance" "main" {
  identifier     = "amsa-gestion-db"
  engine         = "mysql"
  engine_version = var.rds_engine_version
  instance_class = var.rds_instance_class

  allocated_storage     = var.rds_storage_gb
  max_allocated_storage = var.rds_max_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result
  port     = 3306

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period   = 7
  skip_final_snapshot       = false
  final_snapshot_identifier = "amsa-gestion-db-final"
  deletion_protection       = true
  apply_immediately         = true

  auto_minor_version_upgrade = true
}
