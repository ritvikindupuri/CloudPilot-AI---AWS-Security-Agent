# CloudPilot AI

**Live Demo URL:** [https://cloudpilot-ai.codeworker.workers.dev/](https://cloudpilot-ai.codeworker.workers.dev/)

Real-time AWS security operations. Connect your credentials to audit, investigate, and remediate cloud infrastructure. An elite AWS cloud security operations agent built exclusively for professional security engineers, featuring zero simulation tolerance (always uses real AWS API calls).

**Read the full [Technical Documentation](TECHNICAL_DOCUMENTATION.md) for a comprehensive breakdown of the architecture, data flow, and codebase.**

**Review our comprehensive [Security Manual](SECURITY.md) for a detailed breakdown of our Zero-Trust architecture, multi-stage guardrails, threat model, and compliance logging.**

---

## System Architecture

![CloudPilot AI — System Architecture and Request Flow](https://i.imgur.com/4uQbqr3.png)
<div align="center">
  <em>Figure 1: CloudPilot AI End-to-End System Architecture and Request Flow</em>
</div>

### Step-by-Step Architecture Flow

1. **User + React Web App & Scan Mode Selector (Step 1)**: The Security Engineer inputs a prompt or triggers a Quick Action via the React Web App (`src/pages/Landing.tsx`, `ChatInterface.tsx`). The user selects the active AI engine via the **Scan Mode** toggle bar:
   - **⚡ Fast Scan (Sonnet 3.5)**: Standard single-pass execution for quick audits, security group checks, and everyday queries (~2–5 sec).
   - **🔍 Deep Security Audit (Opus / Deep Reasoning)**: Extended multi-pass execution for CIS Benchmark evaluations, IAM privilege escalation paths, and CloudTrail correlation (~10–20 sec).
2. **Auth + AWS Credential Exchange (Step 2)**: Supabase Auth handles user identity and RBAC. `aws-exchange-credentials` validates access keys or AssumeRole ARNs against AWS STS, issuing temporary 1-hour session tokens with **zero raw-key storage**.
3. **aws-agent Orchestrator (Step 3)**: The prompt reaches the core `aws-agent` Orchestrator edge function, which executes a 4-stage pipeline:
   - **Intent Classifier:** Classifies query intent and filters the active tool set.
   - **Claude Main Agent:** Generates proposed AWS SDK tool calls based on user intent.
   - **Scan Mode Router:** Evaluates request complexity and applies single-pass or extended reasoning execution strategies.
   - **Safety Gate Judge:** Audits proposed tool calls and outputs a live `[Safety Gate] APPROVED` or `REJECTED` verdict.
4. **aws-agent-tools Router & Execution Path (Step 4)**: Dispatches tool calls by domain through the appropriate path:
   - **Fast Scan Path (Single-Pass)**: Direct, single-pass tool execution (~2–5 sec).
   - **Deep Audit Path (Multi-Pass)**: Extended reasoning and recursive, multi-step tool execution (~10–20 sec).
5. **Domain Execution Engines (Step 5)**: Routes execution to either `aws-agent-scanner` (security audits, cost scans, drift detection, direct queries) or `aws-agent-ops` (runbooks, IAM changes, security group changes, org ops, attack simulation).
6. **aws-executor (Step 6)**: Centralized AWS SDK proxy executing single-pass or recursive multi-pass API calls directly against AWS endpoints.
7. **Customer AWS Account & Deep Audit Capabilities (Step 7)**: Executes commands directly against AWS services (`IAM`, `S3`, `EC2`, `VPC`, `CloudTrail`, `CloudWatch`, `GuardDuty`, `Organizations`, `Cost Explorer`, `SNS`, `STS`, `Lambda`). In Deep Audit mode, unlocks CIS Benchmark evaluation, IAM privilege escalation path discovery, nested security group analysis, cross-account trust analysis, S3 ACL/policy inspection, and CloudTrail historical correlation. Real-time alerts route to `Notifications` (Slack, PagerDuty, webhooks, SNS/email) and log to `Compliance & Governance` (approval workflows, audit timelines, evidence exports).
8. **Results Returned to App (Step 8)**: Real AWS API responses return to `aws-agent`. Claude synthesizes live findings, remediation guidance, reports, and approved actions, streaming live Markdown back to the React Web App via SSE.

---

## Smart Intent Router & Dual Scan Engines

CloudPilot AI features a **Dual Scan Engine architecture** combined with a lightweight LLM intent router, allowing users to choose the optimal balance of speed, cost, and reasoning depth:

### Scan Modes

| Mode | Engine / Model | Speed | Ideal Use Cases |
|------|---------------|-------|-----------------|
| **⚡ Fast Scan** | Claude 3.5 Sonnet | ~2–5 sec | Quick security audits, listing S3 buckets, inspecting security group rules, and everyday interactive queries. |
| **🔍 Deep Audit** | Claude 3 Opus / Extended Reasoning | ~10–20 sec | Multi-pass CIS Benchmark evaluations, nested security group cross-references, IAM privilege escalation path discovery, and historical CloudTrail event correlation. |

### Intent Classifier Matrix

The Intent Router pre-classifies queries to select only the required tool subset:

| Component | Model | Purpose |
|-----------|-------|---------|
| **Intent Classifier** | Claude 3.5 Sonnet | Single-shot query classification into 9 intent categories (~100-200ms) |
| **Main Agent** | Claude 3.5 Sonnet / Claude 3 Opus | Multi-iteration agentic loop with filtered tool set (up to 15 iterations) |
| **Safety Gate Judge** | Claude 3.5 Sonnet | Audits proposed AWS API tool calls against safety policies and user intent |

### Intent Categories

| Intent | Tools Selected | Example |
|--------|---------------|---------|
| `security_audit` | 4 tools | "Audit my S3 buckets" |
| `cost_analysis` | 3 tools | "Where am I wasting money?" |
| `drift_detection` | 3 tools | "Show overnight drift" |
| `org_management` | 3 tools | "Which accounts lack MFA?" |
| `ops_automation` | 4 tools | "Run incident response playbook" |
| `attack_simulation` | 3 tools | "Simulate privilege escalation" |
| `event_automation` | 3 tools | "If anyone opens port 22, close it" |
| `direct_query` | 1 tool | "List my S3 buckets" |
| `general` | All 15 tools | Ambiguous or multi-domain queries |

### Why Claude 3.5 Sonnet & Claude 3 Opus?

- **Top-Tier Tool Calling**: Native function-calling and tool-use support with near-zero hallucination rates, ensuring correct AWS SDK payloads.
- **Advanced Cloud Reasoning**: Excellent understanding of cloud security benchmarks, IAM structures, cost vectors, and drift patterns.
- **Safety Gate Integration**: High-precision evaluation of API payloads against user safety rules, preventing accidental data loss or security breaches.

---

## Automated Scheduling — pg_cron

The `guardian-scheduler` edge function runs automatically every hour via PostgreSQL's native `pg_cron` extension, eliminating the need for external scheduling services:

- **Schedule**: `0 * * * *` (top of every hour)
- **Mechanism**: `pg_net` HTTP POST from within the database to the edge function endpoint
- **Authentication**: `x-guardian-secret` header validates against `GUARDIAN_AUTOMATION_WEBHOOK_SECRET`
- **Actions**: Cost anomaly scanning, drift detection, and SNS alert dispatch

This approach is simpler than AWS EventBridge because it runs inside the database with zero external dependencies.

---

## Key Features

- **Live AWS API Execution**: Connect your credentials to audit, investigate, and remediate cloud infrastructure using real AWS API responses.
- **Smart Intent Router**: LLM-based query classification selects only relevant tools per query, reducing token usage by 40-70%.
- **Pre-Flight IAM Boundary Checks**: The application automatically evaluates your principal's permissions upon connection, presenting a green/red checklist.
- **PrivateLink / VPC Endpoints**: CloudPilot backend can be deployed inside an AWS VPC with VPC Endpoints (AWS PrivateLink), allowing API calls to never traverse the public internet.
- **WORM Audit Logging**: Every AWS SDK call payload is streamed into an immutable, Write-Once-Read-Many (WORM) S3 bucket.
- **Automatic Industry-Grade Reports**: Every query generates a structured security report with executive summary, findings table, risk matrix, remediation plan, and compliance mapping.
- **Email Notifications via AWS SNS**: Configure a notification email — the agent automatically creates an SNS topic, subscribes your email, and sends report summaries.
- **Log Analyst & Threat Detector**: Parses and summarizes CloudTrail and CloudWatch logs while utilizing GuardDuty for anomaly and IOC pattern matching.
- **IP Safety Checking & Automated Actions**: Identifies untrusted IPs and automates blocking, alongside revoking IAM credentials when a compromise is detected.
- **Attack Simulation**: Authorized testing against your own account to discover privilege escalation paths, credential exposure, and lateral movement vectors.
- **Compliance Scanning**: Automates mapping against CIS AWS Foundations Benchmark, NIST 800-53, PCI-DSS v4.0, ISO 27001, and 13 more frameworks.
- **Incident Response & Forensics**: Tools for live instance isolation, credential revocation, and forensic evidence preservation.
- **Task Automator**: Streamlines runbook execution for rapid remediation using real AWS APIs.
- **Actionable Remediation Commands**: Generates exact, context-aware AWS CLI commands to remediate findings immediately.
- **Reporting & Alerts Engine**: Generates HTML/Markdown output alongside severity-tiered alerting (Critical/High/Medium/Low via SNS/Lambda).
- **Operations Control Plane**: A centralized UI dashboard (`/operations`) aggregating event policies, cost rules, drift status, runbook history, and organization rollouts.
- **Real-Time Reactive Automations**: EventBridge + Lambda for live CloudTrail reactions and pg_cron for scheduled cost and drift polling.
- **Live Streaming Executions**: Realtime runbook step streaming directly in the UI with actual notification delivery paths.
- **Enterprise Ready Authentication**: Enforced email verification and SSO/SAML integrations built natively into the authentication flows.
- **Secure API Edge Architecture**: Supabase Edge Functions strictly enforce `verify_jwt = true` alongside built-in sliding-window rate limiting.
- **Client-Side Observability**: Integrated Sentry error monitoring provides robust insights into client-side failures and user-flow bottlenecks.
- **Streamlined Team Invites**: Zero-friction team onboarding that handles shadow accounts for users who haven't signed up yet.
- **Automated Test Coverage**: Comprehensive test suites running via Vitest to provide a continuous integration safety net.

---

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, shadcn-ui, Framer Motion
- **Backend / API:** Local Deno Gateway (`local-server.ts`), running Edge Function modules locally on port 54321
- **Database / Auth:** Mocked locally using browser `localStorage` and client-side session handlers
- **AI Model:** Anthropic Claude 3.5 Sonnet (via official API)
- **Cloud Integration:** AWS SDK for JavaScript v3 (35+ services)

---

## Detailed Setup Instructions

Follow these steps to run the application locally.

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+) & npm installed (or [Bun](https://bun.sh/) as an alternative package manager).
- An [Anthropic API Key](https://console.anthropic.com/) to invoke Claude 3.5 Sonnet.
- No database setup or Docker installation is needed! Everything runs locally on your machine.

### 1. Clone & Install Dependencies

```sh
# Clone the repository
git clone <https://github.com/ritvikindupuri/aws-guardian-buddy.git>
cd <aws-guardian-buddy>

# Install the necessary dependencies
npm install
# or
bun install
```

### 2. Configure Environment Variables

Create a `.env` file in the root directory (if not present) and configure your Anthropic API Key:

```env
ANTHROPIC_API_KEY="your-anthropic-api-key-here"
```

### 3. Start the Development Server

The development command launches both the React Vite frontend and the local Deno server gateway emulating the Supabase API endpoints internally on port 54321:

```sh
# Start the dev environment (Vite frontend + Deno mock backend)
npm run dev
# or
bun run dev
```

Open your browser to the local URL provided (usually `http://localhost:8080`). All database states will be persisted in your local `cloudpilot.db` SQLite file.

---

## How to Use CloudPilot AI

### 1. Connect your AWS Account
Upon launching the application, you will be guided by the **Getting Started** checklist.
* **Access Keys:** Create an IAM user with `SecurityAudit` and `IAMFullAccess` policies, generate Access Keys, and paste them into the onboarding panel (Step 1).
* **Assume Role:** If you prefer cross-account role auditing, configure the Role ARN under the "Assume Role" tab.
* **IAM Pre-Flight Check:** The application automatically runs a capability checklist to verify what permissions are active.

### 2. Run Interactive Tours
Navigate to the specialized control planes in the navigation tabs and start the guided, auto-scrolling walkthroughs:
* **Operations Control Plane (`/operations`):** Click **Start Tour** at the top. The UI will dim, highlighting and centering each operational dashboard card (Event Policies, Cost Rules, Drift Baselines, Runbooks, Audit Timelines) to show you how to audit and automate real-time AWS activity.
* **Compliance Control Plane (`/compliance`):** Click **Start Tour** to spotlight the framework compliance dials, interactive audit checklists, and framework selectors (SOC 2, ISO 27001, HIPAA, PCI-DSS).

### 3. Query the AI Security Agent
Type your security questions or commands into the main Chat interface. Examples:
* *"Audit my S3 buckets for public access"*
* *"Show me any security groups with port 22 open to the world"*
* *"Create a secure VPC infrastructure layout for us-east-1"*
* *"Are there any idle EC2 instances costing me money?"*

### 4. Investigate & Remediate
* **Interactive Findings:** Browse findings dynamically in the right-hand inspection panel.
* **Remediation CLI:** Copy the exact, context-aware AWS CLI commands generated by the agent to secure your infrastructure.
* **S3 Report Archival:** Click **Add to S3** or **Download PDF** to generate compliance records of your security audits.

---

## AWS Setup Instructions

To use CloudPilot AI, you need to provide it with access to your AWS account. We recommend creating a dedicated IAM Role or User with **SecurityAudit** or **ReadOnlyAccess** permissions.

### Option A: Create an IAM User (for Access Keys)

1. Log in to the [AWS Management Console](https://console.aws.amazon.com/).
2. Navigate to **IAM (Identity and Access Management)**.
3. Click on **Users** in the left sidebar, then click **Create user**.
4. Enter a username (e.g., `CloudPilotAI-Agent`) and click **Next**.
5. Under **Permissions options**, select **Attach policies directly**.
6. Search for and select the **`SecurityAudit`** managed policy. (Alternatively, use `ViewOnlyAccess` or `ReadOnlyAccess` depending on your required scope). Click **Next**, then **Create user**.
7. Click on the newly created user from the Users list.
8. Go to the **Security credentials** tab.
9. Scroll down to **Access keys** and click **Create access key**.
10. Select **Command Line Interface (CLI)** or **Third-party service**, check the confirmation box, and click **Next**.
11. Click **Create access key**.
12. **Important:** Copy the **Access Key ID** and **Secret Access Key**. *You will not be able to see the Secret Access Key again.*
13. Enter these credentials into the CloudPilot AI interface.

### Option B: Create an IAM Role (for AssumeRole)

*Note: You still need an initial IAM User/Identity to assume this role. This is useful for cross-account setups.*

1. Log in to the [AWS Management Console](https://console.aws.amazon.com/).
2. Navigate to **IAM (Identity and Access Management)**.
3. Click on **Roles** in the left sidebar, then click **Create role**.
4. Select **AWS account** as the trusted entity type.
5. Choose **This account** or **Another AWS account** (if running CloudPilot from a central security account), and click **Next**.
6. Search for and select the **`SecurityAudit`** managed policy. Click **Next**.
7. Name your role (e.g., `CloudPilot-AuditRole`) and click **Create role**.
8. Search for your newly created role and click on it.
9. At the top of the summary page, copy the **ARN** (it will look like `arn:aws:iam::123456789012:role/CloudPilot-AuditRole`).
10. Ensure the AWS credentials you provide to the application have the `sts:AssumeRole` permission for this specific Role ARN.
11. Enter the Role ARN into the CloudPilot AI interface under the "Assume Role" tab.

---

## Understanding Agent Capabilities via IAM Roles

The AI agent's power is strictly limited to the permissions of the AWS credentials you provide. It **cannot bypass** your IAM policy. Here is exactly what the agent can do based on the two most common role configurations:

### Option 1: `SecurityAudit` (Read-Only)
If you provide credentials with only the `SecurityAudit` managed policy, the agent **can**:
- Audit S3 buckets, IAM posture, security groups, and EC2 instances.
- Run CIS Benchmark, CloudTrail, GuardDuty, and Security Hub compliance checks.
- Discover and map attack paths (e.g., privilege escalation vectors, lateral movement, network exposure).
- Act as a Log Analyst (parse CloudTrail/CloudWatch) and Threat Detector (query GuardDuty/WAF findings).
- Generate a Report Builder payload containing security findings.

The agent **cannot** (and will receive an `AccessDenied` error if you ask it to):
- Block malicious IPs.
- Revoke IAM credentials.
- Isolate instances or create forensic snapshots.
- Execute any task automation or remediation commands that alter infrastructure.

### Option 2: `AdministratorAccess` (Read/Write)
If you provide credentials with the `AdministratorAccess` managed policy (or a custom policy with explicit write permissions), the agent can perform all the read-only tasks above, **plus it can execute automated actions**:
- **Block Malicious IPs:** Automatically update WAF IP sets or NACLs.
- **Revoke IAM:** Deactivate access keys and detach policies for compromised users.
- **Incident Response:** Isolate EC2 instances by changing security groups and disabling IMDS, or create forensic EBS snapshots.
- **Task Automator:** Execute exact AWS CLI remediation commands to close public buckets, enforce MFA, or harden IMDSv2.
- **Email Engine:** Configure and send alerts via AWS SES.

---

## IAM Permissions Needed for Automated Actions & Features

If you prefer to build a custom least-privilege role instead of using `AdministratorAccess`, executing automated remediation or alerting engines requires explicit write permissions:

| Feature Capability | Required IAM Actions |
|-------------------|----------------------|
| **Log Analyst & Threat Detector** | `cloudtrail:LookupEvents`, `cloudwatch:GetMetricData`, `guardduty:GetFindings` |
| **Block Malicious IPs** | `wafv2:UpdateIPSet`, `ec2:CreateNetworkAclEntry`, `ec2:ReplaceNetworkAclEntry` |
| **Revoke IAM Credentials & Role Management** | `iam:UpdateAccessKey`, `iam:DetachUserPolicy`, `iam:DeleteAccessKey`, `iam:CreateRole`, `iam:AttachRolePolicy`, `iam:PassRole` |
| **Task Automator (Remediation)** | Varies per runbook (e.g., `s3:PutBucketPublicAccessBlock`, `ec2:RevokeSecurityGroupIngress`) |
| **Email Alert Engine** | `ses:GetIdentityVerificationAttributes`, `ses:SendEmail`, `sns:ListSubscriptionsByTopic` |
| **Audit Archive Verification** | `dynamodb:DescribeTable`, `s3:GetBucketObjectLockConfiguration` |

---

## Agent Security & Safety Mechanisms

Given the power of executing live AWS API calls, CloudPilot AI implements multiple layers of security to protect your environment and ensure safe operations. For a detailed breakdown of our security architecture, validation gates, and threat models, please refer to our comprehensive **[SECURITY.md](SECURITY.md)** posture manual.

Our security guardrails and data privacy architecture include:

- **Stateless Zero-Credential Storage:** AWS secret keys are never saved to a database or disk. Credentials exist purely in transient client memory or temporary 1-hour AWS STS session tokens.
- **Private VPC Endpoint Routing (AWS PrivateLink):** Supports private DNS routing inside your Virtual Private Cloud (VPC), ensuring AWS SDK API traffic never routes over the public internet.
- **Dual-LLM Safety Gate Judge:** Every proposed tool call is pre-screened in real time by an independent Safety Gate Judge before dispatch, displaying a live `[Safety Gate] APPROVED` or `REJECTED` verdict in the UI.
- **Configurable Least-Privilege IAM Scoping:** Connect using a Read-Only IAM Role (`SecurityAudit`) where AWS itself physically blocks write API calls, or enable Remediation mode under active Safety Gate Judge oversight.
- **Immutable S3 WORM Compliance Logs:** Every transaction payload is automatically archived into your own S3 bucket configured with S3 Object Lock in WORM (Write-Once-Read-Many) Compliance Mode for forensic integrity.
- **Zero Simulation Tolerance:** The agent is strictly instructed to **never** fabricate or assume resource states. Every finding must be backed by a real AWS API response.
- **Destructive Operation Blocklist:** Highly sensitive operations (e.g., `closeAccount`, `terminateInstances`, `deleteBucket`) are hardcoded to be blocked.

---

## API Limits & Rate Limiting

| Limit | Value | Impact When Exceeded |
|-------|-------|---------------------|
| Max messages per request | 100 | HTTP 400 error |
| Max message content length | 50,000 characters | HTTP 400 error |
| Max agentic loop iterations | 15 | Agent returns warning to narrow the query |
| Max AWS API response size | 100KB | Response truncated with `[TRUNCATED]` marker |
| STS AssumeRole session | 1 hour | Temporary credentials expire; must reconnect |
| AI Gateway rate limit | Per-account | HTTP 429: "Rate limit exceeded" |
| AI usage credits | Per-account | HTTP 402: "AI usage credits exhausted" |

For full details on input validation, rate limiting behavior, and practical implications, see the [Technical Documentation](TECHNICAL_DOCUMENTATION.md#api-limits--rate-limiting).
