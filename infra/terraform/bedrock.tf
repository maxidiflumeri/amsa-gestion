# ============ Asistente de IA: invocación de Claude en Bedrock (docs/asistente-spec.md §13, docs/asistente-reportes-spec.md §17) ============
# Perfiles regionales "us." de bedrock-runtime: el "global." lo bloquea un SCP de la organización (verificado 16/10/2026).
# Haiku 5.5: ayuda y navegación (Fase A). Sonnet 5.5: el constructor de reportes (Fase B).
locals {
  asistente_modelos = ["claude-haiku-5-5", "claude-sonnet-5-5"]
  asistente_perfiles_arn = [
    for m in local.asistente_modelos : "arn:aws:bedrock:${var.region}:${local.account_id}:inference-profile/us.anthropic.${m}"
  ]
  asistente_modelos_arn = flatten([
    for m in local.asistente_modelos : [
      for r in ["us-east-1", "us-east-2", "us-west-2"] : "arn:aws:bedrock:${r}::foundation-model/anthropic.${m}"
    ]
  ])
}

data "aws_iam_policy_document" "ec2_bedrock" {
  statement {
    sid       = "AsistentePerfiles"
    actions   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = local.asistente_perfiles_arn
  }

  statement {
    sid       = "AsistenteModelosViaPerfil"
    actions   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = local.asistente_modelos_arn
    condition {
      test     = "StringEquals"
      variable = "bedrock:InferenceProfileArn"
      values   = local.asistente_perfiles_arn
    }
  }
}

resource "aws_iam_role_policy" "ec2_bedrock" {
  name   = "amsa-gestion-ec2-bedrock"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.ec2_bedrock.json
}
