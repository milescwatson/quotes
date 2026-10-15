resource "aws_s3_bucket" "organization_logos" {
  bucket        = "${local.name}-organization-logos-${var.account_id}-${var.region}"
  force_destroy = false
}
resource "aws_s3_bucket_public_access_block" "organization_logos" {
  bucket                  = aws_s3_bucket.organization_logos.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "organization_logos" {
  bucket = aws_s3_bucket.organization_logos.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "organization_logos" {
  bucket = aws_s3_bucket.organization_logos.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_policy" "organization_logos" {
  bucket = aws_s3_bucket.organization_logos.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Sid       = "RequireTLS", Effect = "Deny", Principal = "*", Action = "s3:*",
    Resource  = [aws_s3_bucket.organization_logos.arn, "${aws_s3_bucket.organization_logos.arn}/*"],
    Condition = { Bool = { "aws:SecureTransport" = "false" } }
  }] })
}
