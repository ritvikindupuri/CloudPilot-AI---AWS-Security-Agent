# CloudPilot AI

**Live Demo URL:** [https://cloudpilot-ai.codeworker.workers.dev/](https://cloudpilot-ai.codeworker.workers.dev/)

Real-time AWS security operations. Connect your credentials to audit, investigate, and remediate cloud infrastructure. An elite AWS cloud security operations agent built exclusively for professional security engineers, featuring zero simulation tolerance (always uses real AWS API calls).

📚 **Read the full [Technical Documentation](TECHNICAL_DOCUMENTATION.md) for a comprehensive breakdown of the architecture, data flow, and codebase.**

---

## System Architecture

```mermaid
sequenceDiagram
    participant User
    participant Frontend as React Frontend
    participant DB as Local Storage (Mock DB)
    participant Gateway as Local Deno Gateway
    participant Agent as aws-agent
    participant Classifier as Anthropic Intent Classifier
    participant LLM as Anthropic Claude 3.5 Sonnet
    participant Judge as Safety Gate Judge (Claude)
    participant AWS as AWS Account

    User->>Frontend: Enter query & credentials
    Frontend->>DB: Save credentials & context
    Frontend->>Gateway: Forward query & credentials
    Gateway->>Agent: Route to Deno aws-agent
    Agent->>Classifier: Classify query intent
    Classifier-->>Agent: Returns intent category
    Agent->>LLM: Forward query + intent-filtered tools
    LLM-->>Agent: Returns proposed AWS tool calls
    Agent->>Judge: Audit proposed AWS tool calls
    Judge-->>Agent: Returns audit verdict (approved/rejected)
    Note right of Agent: If approved, execute real AWS API calls
    Agent->>AWS: Executes real AWS SDK calls (aws-executor)
    AWS-->>Agent: Returns AWS API JSON response
    Agent->>LLM: Provide API response context
    LLM-->>Agent: Synthesizes final security analysis
    Agent-->>Gateway: Returns streaming SSE chunks
    Gateway-->>Frontend: Streams Markdown response
    Frontend-->>User: Displays real-time insights
```
<div align="center">
  <em>Figure 1: CloudPilot AI System Architecture and Request Flow</em>
</div>

### Architecture Explanation

1. **User Interaction**: The user accesses the React Frontend, inputs their AWS query (e.g., "Find exposed S3 buckets"), and provides their AWS credentials (either Access Keys or an AssumeRole ARN).
2. **Request Handling**: The frontend securely sends the prompt and credentials to the Local Deno Gateway (`local-server.ts`), which mounts and executes the `aws-agent` module locally on port 54321.
3. **Intent Classification**: Before engaging the main AI model, `aws-agent` sends the query to the Anthropic API for intent classification using Claude 3.5 Sonnet. The classifier categorizes the query into one of 9 domains (e.g., `security_audit`, `cost_analysis`, `drift_detection`), and only the relevant tool subset is selected for the main agent. This reduces token usage by 40-70% on focused queries.
4. **AI Evaluation**: The local Deno router builds the system context (enforcing "zero simulation tolerance") and communicates with Claude 3.5 Sonnet via the Anthropic completions API, providing only the filtered tool definitions for the classified intent.
5. **Safety Gate Judge**: Before executing any proposed AWS commands, a separate Claude 3.5 Sonnet reasoning call acts as a Safety Gate Judge to audit the proposed actions against the user's intent. If it detects unsafe, destructive, or irrelevant mutations (such as deleting active resources unless explicitly commanded), it blocks execution and feeds the reason back to the agent for self-correction.
6. **AWS Integration**: Once approved, the local gateway dynamically instantiates an AWS SDK client using the user's provided credentials and executes the requested API call against the user's real AWS account via the `aws-executor` module.
7. **Synthesis & Streaming**: The real AWS API responses are passed back to Claude. The model synthesizes an executive summary, findings table, detailed analysis, and exact CLI remediation commands. The gateway streams this response back to the React Frontend for real-time display via SSE.
8. **Database Storage**: Conversations, user sessions, runbooks, compliance configurations, and drift baselines are persisted completely client-side inside the browser's `localStorage` mock client, guaranteeing zero setup and 100% offline data privacy.

---

## Smart Intent Router — Two-Model Architecture

CloudPilot AI employs a lightweight LLM-based intent router that classifies each user query before engaging the main agent:

| Component | Model | Purpose |
|-----------|-------|---------|
| **Intent Classifier** | Claude 3.5 Sonnet | Single-shot query classification into 9 intent categories (~100-200ms) |
| **Main Agent** | Claude 3.5 Sonnet | Multi-iteration agentic loop with filtered tool set (up to 15 iterations) |
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

### Why Claude 3.5 Sonnet?

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

Given the power of executing live AWS API calls, CloudPilot AI implements multiple layers of security to protect your environment and ensure safe operations:

- **Zero Simulation Tolerance:** The agent is strictly instructed to **never** fabricate or assume resource states. Every finding must be backed by a real AWS API response.
- **Service Allowlisting:** The agent is restricted to 35 pre-approved security-relevant AWS services.
- **Destructive Operation Blocklist:** Highly sensitive operations (e.g., `closeAccount`, `terminateInstances`, `deleteBucket`) are hardcoded to be blocked.
- **Strict Input Validation & Sanitization:** All inputs undergo strict regex formatting checks and length sanitization.
- **Ephemeral Compute Isolation:** Agent logic runs in Supabase Edge Functions (Deno isolates) — zero global state or cross-tenant credential exposure.
- **Mandatory Simulation Cleanup:** Test resources from attack simulations must be tagged, tracked, and cleaned up.

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
