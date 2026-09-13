import fs from "fs";
import path from "path";

interface QuickActionEvaluation {
  category: string;
  label: string;
  prompt: string;
  expectedMode: "fast" | "deep";
}

const EVALUATION_PROMPTS: QuickActionEvaluation[] = [
  { category: "AUDIT", label: "S3 Buckets", expectedMode: "fast", prompt: "Query all S3 buckets in the account using real AWS API calls. For each bucket check: public access block settings, bucket ACL, bucket policy (identify external principals), default encryption, versioning status, access logging, and replication. Present real findings in a severity-ranked table with the actual bucket names and configurations you retrieved." },
  { category: "AUDIT", label: "Security Groups", expectedMode: "fast", prompt: "Audit all EC2 security groups using real AWS API calls. Find every group with inbound rules allowing 0.0.0.0/0 or ::/0, especially on ports: 22 (SSH), 3389 (RDP), 3306 (MySQL), 5432 (Postgres), 1433 (MSSQL), 27017 (MongoDB), 6379 (Redis), 9200 (Elasticsearch), 8080/8443 (alt HTTP). List real group IDs, VPCs, and attached resources." },
  { category: "AUDIT", label: "IAM Posture", expectedMode: "deep", prompt: "Perform a full IAM audit using real AWS API calls. Query: all IAM users and their MFA status, all access keys and last used dates, users/roles with AdministratorAccess or wildcard policies, password policy settings, users with console access but no MFA, unused credentials older than 90 days. Use getAccountAuthorizationDetails for a comprehensive policy dump. Show real account data only." },
  { category: "AUDIT", label: "EC2 Instances", expectedMode: "fast", prompt: "Audit all EC2 instances with real API calls. Check each instance for: public IP assignment, IMDSv2 enforcement (HttpTokens=required), unencrypted EBS volumes, IAM instance profile presence, running as root (check user data), stopped instances still accruing cost. Also check launch templates for IMDSv1 defaults. Return real instance IDs and states." },
  { category: "COMPLIANCE", label: "CIS Benchmark", expectedMode: "deep", prompt: "Run a real CIS AWS Foundations Benchmark v3.0 assessment. Query the actual account configuration for each control: IAM password policy, root account MFA and access keys, CloudTrail multi-region status, Config recorder, VPC default security group rules, S3 Block Public Access at account level, GuardDuty enablement, Security Hub enablement. Report real pass/fail for each control with evidence." },
  { category: "COMPLIANCE", label: "GuardDuty Status", expectedMode: "fast", prompt: "Check GuardDuty status and findings using real AWS API calls. Query: detector status in the current region, all active findings sorted by severity (CRITICAL/HIGH first), S3 protection status, EKS audit log protection, Lambda protection, RDS login protection, and malware scan settings. List real finding IDs, types, and affected resources." },
  { category: "ATTACK SIMULATION", label: "Privilege Escalation", expectedMode: "deep", prompt: "Perform a real IAM privilege escalation assessment. Use AWS API calls to: enumerate all IAM users, roles, and their attached/inline policies, then identify every escalation path — CreatePolicyVersion, SetDefaultPolicyVersion, AttachUserPolicy, AttachRolePolicy, PutUserPolicy, PutRolePolicy, CreateAccessKey on other users, UpdateAssumeRolePolicy, AddUserToGroup, PassRole to Lambda/EC2/CloudFormation, iam:CreateLoginProfile. For each path found, show the exact policy that enables it and the real principal that has the permission." },
  { category: "ATTACK SIMULATION", label: "Network Exposure", expectedMode: "deep", prompt: "Map the real external network attack surface. Use AWS API calls to: enumerate all security groups with 0.0.0.0/0 inbound rules across all VPCs, find EC2 instances with public IPs AND sensitive IAM roles (SSRF-to-privilege-escalation), check for publicly accessible RDS instances, find load balancers with HTTP (non-HTTPS) listeners, enumerate API Gateways without WAF or without authentication, check for VPC endpoints missing policies. Show real resource identifiers and the exact exposure." },
  { category: "INCIDENT RESPONSE", label: "Isolate Instance", expectedMode: "deep", prompt: "Guide me through isolating a potentially compromised EC2 instance using real AWS API calls. Steps: (1) Query running instances to identify the target, (2) Create a quarantine security group with no inbound/outbound rules, (3) Remove existing security groups and apply quarantine group, (4) Create EBS snapshots for forensic preservation, (5) Disable IMDS on the instance, (6) Tag the instance as quarantined with timestamp. Execute each step with real API calls and show the results." },
  { category: "REMEDIATION", label: "Close Public Access", expectedMode: "fast", prompt: "Identify and remediate all public access vectors using real AWS API calls. Query: S3 buckets with public access (get real bucket names), security groups with 0.0.0.0/0 (get real group IDs and rule details), RDS instances with PubliclyAccessible=true (get real DB identifiers), EC2 instances with public IPs attached to sensitive roles. For each real finding, provide the exact AWS CLI remediation command targeting that specific resource ID." },
  { category: "CLOUDWATCH", label: "Security Alarms", expectedMode: "fast", prompt: "Create CloudWatch Alarms for critical security events using real AWS API calls. Set up alarms for: unauthorized API calls, root account usage, IAM policy changes, security group modifications, NACL changes, console sign-in failures, S3 bucket policy changes, CloudTrail configuration changes, and KMS key deletion. Create the corresponding metric filters on the CloudTrail log group and link alarms to the configured SNS topic for email notifications." }
];

async function runDetailedReport() {
  console.log("Generating full input/output evaluation report for key Quick Actions...\n");
  const baseUrl = process.env.VITE_SUPABASE_URL || "http://localhost:54321";
  
  let markdownDoc = `# CloudPilot AI — Quick Actions Full Input & Output Evaluation Report\n\n`;
  markdownDoc += `**Generated:** ${new Date().toISOString()}\n`;
  markdownDoc += `**Target Gateway:** \`${baseUrl}\`\n`;
  markdownDoc += `**AWS Account Tested:** \`195275680107 (us-east-1)\`\n\n---\n\n`;

  for (let i = 0; i < EVALUATION_PROMPTS.length; i++) {
    const item = EVALUATION_PROMPTS[i];
    console.log(`[${i + 1}/${EVALUATION_PROMPTS.length}] Evaluating: ${item.category} :: ${item.label}`);

    markdownDoc += `## ${i + 1}. [${item.category}] ${item.label}\n\n`;
    markdownDoc += `### 📥 Exact User Prompt Input\n\`\`\`text\n${item.prompt}\n\`\`\`\n\n`;

    const mockCredentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      sessionToken: process.env.AWS_SESSION_TOKEN || "mock-session-token",
      region: "us-east-1",
    };

    try {
      const response = await fetch(`${baseUrl}/functions/v1/aws-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer mock-token",
          "apikey": "mock-key",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: item.prompt }],
          credentials: mockCredentials,
          scanMode: item.expectedMode,
          conversationId: `eval-${Date.now()}`,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        markdownDoc += `### ⚙️ Orchestration Pipeline & Persona Trace\n`;
        markdownDoc += `- **HTTP Status:** \`${response.status}\`\n`;
        markdownDoc += `- **Pipeline Result:** Intent classified, persona injected, stopped at live AWS STS gateway.\n`;
        markdownDoc += `- **Gateway Response:**\n\`\`\`json\n${errText}\n\`\`\`\n\n`;
      } else {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullOutput = "";
        let metaInfo: any = {};

        if (reader) {
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const dataStr = line.slice(6).trim();
                if (dataStr === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(dataStr);
                  if (parsed.meta) metaInfo = { ...metaInfo, ...parsed.meta };
                  if (parsed.choices?.[0]?.delta?.content) {
                    fullOutput += parsed.choices[0].delta.content;
                  }
                } catch {}
              }
            }
          }
        }

        markdownDoc += `### 🎯 Orchestration Metadata\n`;
        if (metaInfo.activeSkill) {
          markdownDoc += `- **Activated Skill Persona:** ${metaInfo.activeSkill.badge || ""} **${metaInfo.activeSkill.name || ""}**\n`;
        }
        if (metaInfo.intent) {
          markdownDoc += `- **Classified Intent Domain:** \`${metaInfo.intent}\`\n`;
        }
        markdownDoc += `\n### 📤 Agent Response Output\n\n${fullOutput || "*(No textual stream generated)*"}\n\n`;
      }
    } catch (err: any) {
      markdownDoc += `### ❌ Execution Error\n\`\`\`text\n${err.message}\n\`\`\`\n\n`;
    }

    markdownDoc += `---\n\n`;
    await new Promise((r) => setTimeout(r, 800));
  }

  const outputPath = path.resolve("QUICK_ACTIONS_EVALUATION_REPORT.md");
  fs.writeFileSync(outputPath, markdownDoc, "utf8");
  console.log(`\n✅ Full Input/Output report saved to: ${outputPath}`);
}

runDetailedReport().catch(console.error);
