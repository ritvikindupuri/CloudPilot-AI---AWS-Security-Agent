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
   - **Fast Scan:** Uses **Claude Sonnet 5** for standard single-pass execution (~2–5 sec) on quick audits, security group checks, and everyday queries.
   - **Deep Security Audit:** Uses **Claude Opus 5** (with extended reasoning limits) for multi-pass execution (~10–20 sec) on CIS Benchmark evaluations, IAM privilege escalation paths, and CloudTrail correlation.
2. **Auth + AWS Credential Exchange (Step 2)**: Supabase Auth handles user identity and RBAC. `aws-exchange-credentials` validates access keys or AssumeRole ARNs against AWS STS, issuing temporary 1-hour session tokens with **zero raw-key storage**.
3. **aws-agent Orchestrator (Step 3)**: The prompt reaches the core `aws-agent` Orchestrator edge function, which executes a 5-stage pipeline:
   - **Intent Classifier:** Classifies query intent into one of 9 categories and filters the active tool set.
   - **Agent Skills Engine:** Loads a domain-specific specialist persona (e.g., 🔐 Security Audit Specialist) and injects specialized system instructions into the agent's context.
   - **Claude Main Agent:** Generates proposed AWS SDK tool calls using a **ReAct (Reasoning and Acting)** agentic loop on **Claude Sonnet 5** (Fast Scan) or **Claude Opus 5** (Deep Audit).
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
| **⚡ Fast Scan** | Claude Sonnet 5 | ~2–5 sec | Quick security audits, listing S3 buckets, inspecting security group rules, and everyday interactive queries. |
| **🔍 Deep Audit** | Claude Opus 5 / Extended Reasoning | ~10–20 sec | Multi-pass CIS Benchmark evaluations, nested security group cross-references, IAM privilege escalation path discovery, and historical CloudTrail event correlation. |

### Intent Classifier Matrix

The Intent Router pre-classifies queries to select only the required tool subset:

| Component | Model | Purpose |
|-----------|-------|---------|
| **Intent Classifier** | Claude Sonnet 5 | Single-shot query classification into 9 intent categories (~100-200ms) |
| **Main Agent** | Claude Sonnet 5 / Claude Opus 5 | Multi-iteration **ReAct (Reasoning and Acting)** loop with filtered tool set (up to 15 iterations) |
| **Safety Gate Judge** | Claude Sonnet 5 | Audits proposed AWS API tool calls against safety policies and user intent |

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

### Agent Skills Engine — Dynamic Persona Injection

After the Intent Classifier selects the query domain, the **Agent Skills Engine** activates a domain-specific specialist persona. Each intent category maps to a unique skill that injects specialized system instructions into the agent's context before the ReAct loop begins:

| Intent | Activated Skill | What It Does |
|--------|----------------|---------------|
| `security_audit` | 🔐 Security Audit Specialist | Prioritizes CIS Benchmark mapping, explicit resource IDs, structured findings tables, and actionable remediation commands |
| `cost_analysis` | 💰 FinOps Cost Analyst | Focuses on exact dollar breakdowns by service/region, idle resource flagging, and ROI-prioritized savings |
| `drift_detection` | 📊 Drift Detection Engineer | Compares live state against baselines, outputs before/after diffs with timestamps and change types |
| `org_management` | 🏢 AWS Organizations Expert | Maps OU hierarchy, audits SCPs for gaps, flags accounts lacking MFA or CloudTrail coverage |
| `ops_automation` | ⚡ Incident Response Operator | Executes runbook steps sequentially with real API calls, requires confirmation before destructive actions |
| `attack_simulation` | 🎯 Red Team Simulation Expert | Discovers privilege escalation paths, maps lateral movement, outputs MITRE ATT&CK technique mappings |
| `event_automation` | 🔔 Event Automation Specialist | Analyzes CloudTrail events, defines response policies, validates against existing SCPs and IAM boundaries |
| `direct_query` | 🔍 Direct Query Agent | Single-pass execution, raw structured output (tables/JSON), includes ARNs, regions, and timestamps |
| `general` | ☁️ General Cloud Security Assistant | Full tool set with comprehensive, multi-domain coverage |

The active skill badge is displayed in real-time in the chat UI (e.g., `🔐 Security Audit Specialist`) so users always know which specialist persona is driving the analysis.

**Why this matters:** Instead of a generic agent answering every query the same way, the Skills Engine transforms the agent into a domain expert for each task — producing more structured, actionable, and contextually relevant output.

### Why Claude Sonnet 5 & Claude Opus 5?

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
- **Agent Skills Engine**: Dynamically activates domain-specific specialist personas (Security Audit Specialist, FinOps Cost Analyst, Red Team Expert, etc.) based on query intent, transforming the agent from a generalist into a focused domain expert for each task.
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
- **AI Model:** Anthropic Claude Sonnet 5 (via official API)
- **Cloud Integration:** AWS SDK for JavaScript v3 (35+ services)

---

## Detailed Setup Instructions

Follow these steps to run the application locally.

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+) & npm installed (or [Bun](https://bun.sh/) as an alternative package manager).
- An [Anthropic API Key](https://console.anthropic.com/) to invoke Claude Sonnet 5.
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
# The main Anthropic API Key
ANTHROPIC_API_KEY="your-anthropic-api-key-here"

# Optional: Customize the models used by the scan engines
# Default for Fast Scan is claude-sonnet-4-6
ANTHROPIC_MODEL="claude-sonnet-4-6"

# Default for Deep Audit is claude-opus-5 (Claude Opus 5)
ANTHROPIC_DEEP_MODEL="claude-opus-5"
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

This step-by-step walkthrough covers every feature of CloudPilot AI. Follow these steps in order to go from zero to a fully operational security command center.

### Step 1: Launch the Application & Create an Account
1. Open the application URL in your browser (locally: `http://localhost:8080`, or the deployed URL).
2. You will land on the **CloudPilot AI landing page** showcasing the platform's capabilities.
3. Click **Get Started** or **Sign In** in the top-right corner.
4. Create an account using your email address, or sign in with an existing account. You must verify your email before proceeding.
5. After signing in, you will be redirected to the **main dashboard**.

### Step 2: Connect Your AWS Account
1. On first login, the **Getting Started checklist** appears in the left panel. This checklist tracks your onboarding progress.
2. Click **Step 1: Connect AWS Credentials** to open the AWS Credentials panel.
3. You have two connection methods:
   - **Access Keys (recommended for personal accounts):** Paste your IAM Access Key ID and Secret Access Key. The application immediately validates them against AWS STS and issues a temporary 1-hour session token. Your raw keys are **never stored** — they exist only in memory.
   - **Assume Role (recommended for cross-account auditing):** Enter the Role ARN (e.g., `arn:aws:iam::123456789012:role/CloudPilot-AuditRole`). The application calls `sts:AssumeRole` to obtain temporary credentials.
4. After successful connection, the **IAM Pre-Flight Check** automatically runs. This evaluates your principal's permissions and displays a green ✅ / red ❌ checklist showing which capabilities are available (e.g., S3 read, IAM audit, CloudTrail access, Security Group modification).
5. A green checkmark appears on Step 1 of the Getting Started checklist.

### Step 3: Choose Your Scan Mode
Before querying the agent, select your preferred AI engine using the **Scan Mode toggle bar** at the bottom of the chat interface:
- **⚡ Fast Scan (Claude Sonnet 5):** Best for quick, focused queries — security group checks, listing resources, single-service audits. Responds in ~2–5 seconds.
- **🔍 Deep Audit (Claude Opus 5):** Best for comprehensive, multi-service analysis — full CIS Benchmark evaluations, IAM privilege escalation path discovery, CloudTrail event correlation. Responds in ~10–20 seconds with extended reasoning.

You can switch between modes at any time. The toggle is always visible below the chat input.

### Step 4: Use Quick Action Prompts
Instead of typing from scratch, CloudPilot provides **prebuilt Quick Action prompts** organized by category. Click the **Quick Actions** button (grid icon) next to the chat input to browse:
- **Security Audits:** "Run a full security audit", "Check S3 public access", "Audit IAM policies"
- **Cost Analysis:** "Show my cost breakdown", "Find idle resources", "Set a budget alert"
- **Drift Detection:** "Capture a baseline", "Show overnight drift", "Compare against last snapshot"
- **Incident Response:** "Run incident response playbook", "Isolate compromised instance"
- **Attack Simulation:** "Simulate privilege escalation", "Map lateral movement paths"
- **Event Automation:** "If anyone opens port 22, close it automatically", "Replay CloudTrail events"

When you click a Quick Action, it populates the chat input so you can **review, customize, or add context** before sending. For example, you might append a specific region or resource name to narrow the scope.

### Step 5: Query the AI Security Agent (Chat Interface)
Type your security question or command into the main chat input and press Enter (or click Send). Here's what happens behind the scenes:
1. **Intent Classification:** The agent classifies your query into one of 9 intent categories (security audit, cost analysis, drift detection, etc.).
2. **Agent Skills Engine:** Based on the classified intent, a **domain-specific specialist persona** activates. You'll see a badge appear in the chat (e.g., `🔐 Security Audit Specialist` or `💰 FinOps Cost Analyst`) indicating which expert is handling your request.
3. **Tool Filtering:** Only the relevant tools for your query are loaded, reducing noise and improving accuracy.
4. **ReAct Loop Execution:** The agent executes a multi-iteration reasoning loop — dynamically selecting AWS SDK tools, invoking them against your live account, evaluating results, and iterating until it has a complete answer.
5. **Safety Gate:** Every proposed AWS API call is pre-screened by an independent Safety Gate Judge. You'll see live `[Safety Gate] APPROVED` or `REJECTED` verdicts in the execution logs.
6. **Streaming Response:** The agent streams its findings back in real-time as structured Markdown — including findings tables, severity ratings, remediation commands, and compliance mappings.

Example queries to try:
- *"Audit my S3 buckets for public access"* → Activates 🔐 Security Audit Specialist
- *"Where am I wasting money?"* → Activates 💰 FinOps Cost Analyst
- *"What changed since last night?"* → Activates 📊 Drift Detection Engineer
- *"Simulate privilege escalation on my IAM roles"* → Activates 🎯 Red Team Simulation Expert
- *"If anyone opens port 22, close it automatically"* → Activates 🔔 Event Automation Specialist
- *"List my EC2 instances in us-east-1"* → Activates 🔍 Direct Query Agent

### Step 6: Inspect Findings & Remediate
After the agent completes its analysis:
1. **Findings Panel (right sidebar):** Click on any finding to expand its details — severity level, affected resource ID, CIS Benchmark mapping, and the exact AWS CLI remediation command.
2. **Account Health Score:** A real-time score (0–100) is calculated based on finding severity, displayed at the top of the dashboard. Scoring uses weighted deductions: Critical (-20), High (-8), Medium (-3), Low (-1), each with caps to prevent score collapse.
3. **Copy Remediation Commands:** Each finding includes a context-aware AWS CLI command you can copy and execute directly in your terminal to fix the issue.
4. **One-Click Fix Prompts:** Click the **Fix** button on any finding to auto-populate a remediation prompt in the chat, letting the agent execute the fix for you (requires write permissions).

### Step 7: Archive Reports & Export Evidence
1. **Add to S3:** Click the **Add to S3** button on any agent response to archive the full security report to your S3 bucket in WORM (Write-Once-Read-Many) compliance mode.
2. **Download PDF:** Click **Download PDF** to generate a local PDF copy of the security report for offline review or compliance evidence.
3. **Email Reports via SNS:** Configure a notification email in the settings panel. The agent automatically creates an SNS topic, subscribes your email, and sends report summaries after each audit.

### Step 8: Explore the Operations Control Plane
Navigate to the **Operations** tab (`/operations`) for a centralized dashboard of all automated security operations:
1. **Event Policies:** View and manage CloudTrail event response rules (e.g., auto-close port 22 if opened).
2. **Cost Rules:** Set budget thresholds and anomaly alerts.
3. **Drift Baselines:** View captured configuration baselines and track deviations.
4. **Runbook History:** See all executed runbooks with step-by-step logs and outcomes.
5. **Audit Timelines:** Browse a chronological log of every agent action taken on your account.
6. Click **Start Tour** at the top of the page for a guided, auto-scrolling walkthrough that highlights each section.

### Step 9: Explore the Compliance Control Plane
Navigate to the **Compliance** tab (`/compliance`) for framework-specific compliance tracking:
1. **Framework Selector:** Choose from SOC 2, ISO 27001, HIPAA, PCI-DSS v4.0, CIS AWS Foundations, NIST 800-53, and more.
2. **Compliance Dials:** Visual gauges showing your compliance percentage per framework.
3. **Interactive Checklists:** Drill into specific controls with pass/fail status and remediation guidance.
4. Click **Start Tour** for a guided walkthrough of the compliance features.

### Step 10: Manage Your Team
1. Navigate to the **Team** section in settings.
2. **Invite members** by email — CloudPilot handles shadow accounts for users who haven't signed up yet.
3. Team members can share conversations, audit histories, and compliance reports.

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
