# ============ Security Groups ============

# --- ALB: HTTPS (y HTTP→redirect) desde internet ---
resource "aws_security_group" "alb" {
  name        = "amsa-gestion-alb"
  description = "ALB amsa-gestion (HTTPS publico)"
  vpc_id      = data.aws_vpc.default.id
  tags        = { Name = "amsa-gestion-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_all" {
  security_group_id = aws_security_group.alb.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# --- EC2: app desde el ALB, SSH desde admin ---
resource "aws_security_group" "ec2" {
  name        = "amsa-gestion-ec2"
  description = "EC2 backend amsa-gestion"
  vpc_id      = data.aws_vpc.default.id
  tags        = { Name = "amsa-gestion-ec2" }
}

resource "aws_vpc_security_group_ingress_rule" "ec2_app" {
  security_group_id            = aws_security_group.ec2.id
  ip_protocol                  = "tcp"
  from_port                    = 3001
  to_port                      = 3001
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_ingress_rule" "ec2_ssh" {
  security_group_id = aws_security_group.ec2.id
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  cidr_ipv4         = var.admin_cidr
}

resource "aws_vpc_security_group_egress_rule" "ec2_all" {
  security_group_id = aws_security_group.ec2.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# --- RDS: 3306 solo desde la EC2 ---
resource "aws_security_group" "rds" {
  name        = "amsa-gestion-rds"
  description = "RDS amsa-gestion (privada, solo EC2)"
  vpc_id      = data.aws_vpc.default.id
  tags        = { Name = "amsa-gestion-rds" }
}

resource "aws_vpc_security_group_ingress_rule" "rds_mysql" {
  security_group_id            = aws_security_group.rds.id
  ip_protocol                  = "tcp"
  from_port                    = 3306
  to_port                      = 3306
  referenced_security_group_id = aws_security_group.ec2.id
}

resource "aws_vpc_security_group_egress_rule" "rds_all" {
  security_group_id = aws_security_group.rds.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
