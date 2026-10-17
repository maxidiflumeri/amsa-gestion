# ============ Asistente de IA: invocación de Claude Haiku 5.5 en Bedrock (docs/asistente-spec.md §13) ============
# Perfil regional "us." de bedrock-runtime: el "global." lo bloquea un SCP de la organización (verificado 16/10/2026).
locals {
  asistente_perfil_arn = "arn:aws:bedrock:${var.region}:${local.account_id}:inference-profile/us.anthropic.claude-haiku-5-5"
}

data "aws_iam_policy_document" "ec2_bedrock" {
  statement {
    sid       = "AsistentePerfilHaiku55"
    actions   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = [local.asistente_perfil_arn]
  }

  statement {
    sid     = "AsistenteModeloViaPerfil"
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = [
      "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-5-5",
      "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-5-5",
      "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-5-5",
    ]
    condition {
      test     = "StringEquals"
      variable = "bedrock:InferenceProfileArn"
      values   = [local.asistente_perfil_arn]
    }
  }
}

resource "aws_iam_role_policy" "ec2_bedrock" {
  name   = "amsa-gestion-ec2-bedrock"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.ec2_bedrock.json
}
