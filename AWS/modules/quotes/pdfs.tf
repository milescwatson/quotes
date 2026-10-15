resource "aws_s3_bucket" "quote_pdfs" {
  bucket        = "${local.name}-quote-pdfs-${var.account_id}-${var.region}"
  force_destroy = false
}
resource "aws_s3_bucket_public_access_block" "quote_pdfs" {
  bucket                  = aws_s3_bucket.quote_pdfs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "quote_pdfs" {
  bucket = aws_s3_bucket.quote_pdfs.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_versioning" "quote_pdfs" {
  bucket = aws_s3_bucket.quote_pdfs.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "quote_pdfs" {
  bucket = aws_s3_bucket.quote_pdfs.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_policy" "quote_pdfs" {
  bucket = aws_s3_bucket.quote_pdfs.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Sid       = "RequireTLS", Effect = "Deny", Principal = "*", Action = "s3:*",
    Resource  = [aws_s3_bucket.quote_pdfs.arn, "${aws_s3_bucket.quote_pdfs.arn}/*"],
    Condition = { Bool = { "aws:SecureTransport" = "false" } }
  }] })
}
resource "aws_sqs_queue" "quote_pdf_dead_letter" {
  name                      = "${local.name}-quote-pdf-dead-letter.fifo"
  fifo_queue                = true
  sqs_managed_sse_enabled   = true
  message_retention_seconds = 1209600
}
resource "aws_sqs_queue" "quote_pdf" {
  name                       = "${local.name}-quote-pdf.fifo"
  fifo_queue                 = true
  sqs_managed_sse_enabled    = true
  visibility_timeout_seconds = 360
  message_retention_seconds  = 345600
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.quote_pdf_dead_letter.arn, maxReceiveCount = 3 })
}
resource "aws_sqs_queue_redrive_allow_policy" "quote_pdf" {
  queue_url            = aws_sqs_queue.quote_pdf_dead_letter.id
  redrive_allow_policy = jsonencode({ redrivePermission = "byQueue", sourceQueueArns = [aws_sqs_queue.quote_pdf.arn] })
}
resource "aws_iam_role" "quote_pdf_worker" {
  name               = "${local.name}-quote-pdf-worker"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_cloudwatch_log_group" "quote_pdf_worker" {
  name              = "/aws/lambda/${local.name}-quote-pdf-worker"
  retention_in_days = 14
}
resource "aws_iam_role_policy" "quote_pdf_worker" {
  role = aws_iam_role.quote_pdf_worker.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.quote_pdf_worker.arn}:*" },
    { Effect = "Allow", Action = ["dsql:DbConnect"], Resource = aws_dsql_cluster.app.arn },
    { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = aws_sqs_queue.quote_pdf.arn },
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.organization_logos.arn}/organizations/*/logos/*" },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "${aws_s3_bucket.quote_pdfs.arn}/organizations/*/quotes/*.pdf" },
    { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.quote_pdfs.arn }
  ] })
}
resource "aws_iam_role_policy" "api_quote_pdfs" {
  role = aws_iam_role.api.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = aws_sqs_queue.quote_pdf.arn },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion"], Resource = "${aws_s3_bucket.quote_pdfs.arn}/organizations/*/quotes/*.pdf" },
    { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.quote_pdfs.arn }
  ] })
}
resource "aws_lambda_function" "quote_pdf_worker" {
  function_name    = "${local.name}-quote-pdf-worker"
  role             = aws_iam_role.quote_pdf_worker.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "quote-pdf-worker.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  memory_size      = 512
  timeout          = 60
  environment { variables = {
    DSQL_ENDPOINT            = "${aws_dsql_cluster.app.identifier}.dsql.${var.region}.on.aws"
    DSQL_USER                = "quotes_pdf_worker"
    ORGANIZATION_LOGO_BUCKET = aws_s3_bucket.organization_logos.id
    QUOTE_PDF_BUCKET         = aws_s3_bucket.quote_pdfs.id
  } }
  depends_on = [aws_iam_role_policy.quote_pdf_worker, aws_s3_bucket_versioning.quote_pdfs]
}
resource "aws_lambda_event_source_mapping" "quote_pdf" {
  event_source_arn        = aws_sqs_queue.quote_pdf.arn
  function_name           = aws_lambda_function.quote_pdf_worker.arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
}
