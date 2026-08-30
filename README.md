# CloudPilot AI

**Live Demo URL:** [https://cloudpilot-ai.codeworker.workers.dev/](https://cloudpilot-ai.codeworker.workers.dev/)

Real-time AWS security operations. Connect your credentials to audit, investigate, and remediate cloud infrastructure. An elite AWS cloud security operations agent built exclusively for professional security engineers, featuring zero simulation tolerance (always uses real AWS API calls).

**Read the full [Technical Documentation](TECHNICAL_DOCUMENTATION.md) for a comprehensive breakdown of the architecture, data flow, and codebase.**

**Review our comprehensive [Security Manual](SECURITY.md) for a detailed breakdown of our Zero-Trust architecture, multi-stage guardrails, threat model, and compliance logging.**

---

## System Architecture

![CloudPilot AI — System Architecture and Request Flow](https://i.imgur.com/2snYJBa.png)
<div align="center">
  <em>Figure 1: CloudPilot AI End-to-End System Architecture and Request Flow</em>
</div>

### Step-by-Step Architecture Flow

1. **Intent Classification (Step 1)**: A natural-language request enters from the React security console. The intent layer analyzes the request and current configuration, maps it to the appropriate security/operations domain, selects the intent category, and narrows the active tool surface to what is relevant for that request.

2. **Skills Layer (Step 2)**: The classified intent activates the matching domain Skill. The Skills layer:
   - loads the matching specialist definition,
   - injects the specialized system instructions for that domain, and
   - applies the Skill-specific tool allowlist.

   This keeps the normal agent loop intact while making the agent behave like the appropriate domain specialist (for example, security audit, IAM, FinOps, drift, incident response, or direct query) with only the tools that specialist is allowed to use.

3. **AWS Credential Exchange — STS (Step 3)**: The user connects through access keys or an AssumeRole ARN. `aws-exchange-credentials` validates the AWS identity and exchanges it through AWS STS for temporary session credentials. Raw long-lived keys are not persisted; the agent executes AWS operations using the temporary session context.

4. **Agent Orchestrator (Step 4)**: The core `aws-agent` orchestrator coordinates the reasoning and execution lifecycle. It combines:
   - the **Scan Mode Router**, which selects Fast Scan or Deep Audit execution behavior,
   - **Action Safety Review**, which checks proposed AWS actions before execution, and
   - **Agent Context Preparation**, which assembles conversation history, the active Skill instructions, temporary AWS context, and the allowed tool set for the agentic loop.

5. **Tool Execution (Step 5)**: The selected scan mode determines the reasoning depth and model used for the request:
   - **Fast Scan — Claude Sonnet 5:** single-pass execution for quick audits, security-group checks, direct resource queries, and everyday security questions (~2–5 seconds).
   - **Deep Audit — Claude Opus 5:** extended, multi-pass reasoning for CIS Benchmark analysis, IAM privilege-escalation paths, nested security-group/S3 inspection, cross-account trust analysis, and historical CloudTrail correlation (~10–20 seconds).

   The callable tool catalog is filtered by the active Skill allowlist. The exposed capabilities span AWS-service queries, security/compliance checks, analysis workflows, and domain/agent operations.

6. **`aws-agent-tools` Router (Step 6)**: Approved tool calls are sent to the thin `aws-agent-tools` routing layer. It routes each call by domain to the correct backend handler instead of loading all execution logic into the main agent.

7. **Tool Handlers (Step 7)**: Routed calls are handled by one of two specialized execution services:
   - **`aws-agent-scanner`** — security audits, compliance/security data collection, cost analysis, drift detection, and direct AWS queries.
   - **`aws-agent-ops`** — operational workflows such as runbooks, IAM/security-group changes, organization operations, incident-response actions, and authorized attack simulation.

8. **`aws-executor` — AWS SDK v3 (Step 8)**: Both handlers delegate approved cloud operations to `aws-executor`, the centralized AWS SDK v3 proxy. `aws-executor` dynamically loads the required AWS service client and performs the real API request with the temporary session credentials.

9. **Customer AWS Account (Step 9)**: `aws-executor` reaches the customer's real AWS APIs, including services such as IAM, S3, EC2, VPC, CloudTrail, CloudWatch, GuardDuty, Organizations, Cost Explorer, SNS, STS, and Lambda. CloudPilot does not simulate resource state; findings and actions are grounded in authenticated AWS API responses.

   **Optional private AWS API routing:** For isolated environments, the execution path can run inside the **Customer VPC**. With **Private DNS** and the required **VPC Endpoints** configured, supported AWS service hostnames resolve to private endpoint addresses, so those AWS SDK calls reach the corresponding AWS Service APIs over the AWS internal network instead of traversing the public internet. This is an optional network path between `aws-executor` and supported AWS APIs; it does not change the agent or tool-routing logic.

   **Operational side paths:**
   - **Notifications:** security/operations events can be dispatched to Slack, PagerDuty, and generic webhooks.
   - **Compliance & Governance:** approval workflows, the audit timeline, and evidence exports provide governance around sensitive or reviewable actions.

10. **Audit Logging (Step 10)**: Tool execution is captured through the audit architecture. The diagram shows the three audit destinations used for accountability:
    - **CloudWatch Logs**
    - **Immutable S3 archive (WORM / Object Lock)**
    - **Local Audit Store (SQLite database)**

    The S3 sink provides the immutable WORM record; the overall design provides triple-sink audit logging of tool executions.

11. **Results Returned to App (Step 11)**: Real AWS results flow back through the agent, where the selected model synthesizes the final response and streams it to the React interface. The user receives **live findings**, **remediation guidance**, **reports**, and **approved actions** based on the authenticated AWS data and executed workflows.

### Supporting UI & State

The architecture also shows two supporting components that operate alongside the main request path:

- **User Interface:** chat, pre-built security workflows, and AWS credential controls feed requests and configuration into the pipeline.
- **Data & State:** `cloudpilot.db` (SQLite) persists application state such as conversations, messages, runbooks, and compliance baselines.

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

#### Skills Catalog & Custom Persona Studio (`/skills`)

Navigate to the **Skills** tab in the top navigation to:
- **Inspect System Directives**: View and copy the exact raw system supplements and prompt directives driving all 9 built-in specialist personas.
- **Author Custom Specialist Skills**: Create your own personas (e.g., `🛡️ Kubernetes & EKS Hardener`, `🏥 HIPAA Compliance Guard`) with custom prompt directives, trigger keywords, and scoped AWS tool access.
- **Quick-Start Templates**: One-click install preset skills for Kubernetes security, HIPAA health data governance, and serverless FinOps.
- **Dynamic Activation**: Custom skills persist in your local database and automatically trigger during chat whenever user queries match your custom trigger keywords.

### Why Claude Sonnet 5 & Claude Opus 5?

- **Top-Tier Tool Calling**: Native function-calling and tool-use support with near-zero hallucination rates, ensuring correct AWS SDK payloads.
- **Advanced Cloud Reasoning**: Excellent understanding of cloud security benchmarks, IAM structures, cost vectors, and drift patterns.
- **Safety Gate Integration**: High-precision evaluation of API payloads against user safety rules, preventing accidental data loss or security breaches.

### CloudPilot In-VPC Mini Agent — Self-Hosted In-VPC Sidecar (`/in-vpc-agent`)

For security-conscious enterprise teams requiring all security telemetry and automated remediation to execute **100% inside their own AWS VPC boundary**, CloudPilot provides the **In-VPC Mini Agent**:

```
┌────────────────────────────────────────────────────────┐
│                   YOUR AWS VPC                         │
│                                                        │
│   [AWS Event: High-risk security group or S3 drift]    │
│                           │                            │
│                           ▼                            │
│   [In-VPC Lambda Agent catches event in real time]     │
│   [Evaluates Zero-Trust rule & Auto-Remediates]        │
│                           │                            │
└───────────────────────────┼────────────────────────────┘
                            │ (TLS audit sync)
                            ▼
┌────────────────────────────────────────────────────────┐
│              CLOUDPILOT WEB DASHBOARD                  │
│                                                        │
│  🟢 Status: Agent Active in us-east-1 (VPC vpc-0a1b)   │
│  • [Live Stream] Auto-closed port 22 on sg-0a9b8c7d    │
│  • [Live Stream] Enforced S3 Public Access Block       │
└────────────────────────────────────────────────────────┘
```

#### Deployment Formats:
1. **1-Click AWS CloudFormation (`deploy/cloudformation/cloudpilot-in-vpc.yaml`)**:
   - Deploys serverless AWS Lambda + EventBridge security rule + IAM Execution Role in under 60 seconds with **$0 idle cost**.
   - Listens to CloudTrail mutation events (`AuthorizeSecurityGroupIngress`, `PutBucketPolicy`, `AttachUserPolicy`).
   - Auto-closes high-risk ports (0.0.0.0/0 on port 22/3389) and enforces S3 Public Access Blocks in `< 2 seconds`.
2. **Drop-in Terraform Module (`deploy/terraform/`)**:
   - Ready-to-use Terraform module with inputs for `vpc_id`, `subnet_ids`, `cloudpilot_api_key`, and `auto_remediation_enabled`.
   - Includes dead-letter queue (DLQ) and CloudWatch Logs retention.

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
- **Containerization:** Docker & Docker Compose (single-command setup)

---

## Detailed Setup Instructions

Choose your preferred method to run CloudPilot AI locally.

### Prerequisites

- An [Anthropic API Key](https://console.anthropic.com/) to invoke Claude Sonnet 5.
- **Option A (Docker):** [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed.
- **Option B (Native):** [Node.js](https://nodejs.org/) (v18+) & npm installed (or [Bun](https://bun.sh/)).

---

### Option A: Docker (Recommended)

The fastest way to get started. Docker handles all dependencies (Node.js, Deno, SQLite) automatically.

#### 1. Clone the Repository

```sh
git clone <https://github.com/ritvikindupuri/aws-guardian-buddy.git>
cd <aws-guardian-buddy>
```

#### 2. Configure Environment Variables

```sh
# Copy the example environment file
cp .env.example .env

# Edit .env and add your Anthropic API key
# ANTHROPIC_API_KEY="your-anthropic-api-key-here"
```

#### 3. Build & Start

```sh
docker compose up --build
```

That's it. Open **http://localhost:8080** in your browser.

| Service | Port | Description |
|---------|------|-------------|
| Frontend (Vite) | `8080` | React web application |
| Backend (Deno) | `54321` | API gateway + SQLite database |

#### Useful Docker Commands

```sh
# Start in background (detached mode)
docker compose up -d --build

# View live logs
docker compose logs -f

# Stop the application
docker compose down

# Stop and remove all data (SQLite database)
docker compose down -v

# Rebuild after code changes
docker compose up --build
```

---

### Option B: Native (Without Docker)

Run directly on your machine using Node.js and npm.

#### 1. Clone & Install Dependencies

```sh
git clone <https://github.com/ritvikindupuri/aws-guardian-buddy.git>
cd <aws-guardian-buddy>

npm install
# or
bun install
```

#### 2. Configure Environment Variables

Create a `.env` file in the root directory:

```env
# Required: Your Anthropic API Key
ANTHROPIC_API_KEY="your-anthropic-api-key-here"

# Optional: Customize the AI models
ANTHROPIC_MODEL="claude-sonnet-4-6"        # Fast Scan engine
ANTHROPIC_DEEP_MODEL="claude-opus-5"       # Deep Audit engine
```

#### 3. Start the Development Server

```sh
npm run dev
# or
bun run dev
```

This launches both the React Vite frontend and the local Deno server gateway concurrently. Open **http://localhost:8080** in your browser. All database states are persisted in your local `cloudpilot.db` SQLite file.

---

## How to Use CloudPilot AI

This step-by-step walkthrough covers every feature of CloudPilot AI. Follow these steps in order to go from zero to a fully operational security command center.

### Step 1: Launch the Application & Create an Account
1. Open the application URL in your browser (locally: `http://localhost:8080`, or the deployed URL).
2. You will land on the **CloudPilot AI landing page** — click **Get Started** or **Sign In** in the top-right corner.
3. Create an account using your email address and verify it via the confirmation link sent to your inbox.
4. After signing in, you are redirected to the **main dashboard** — this is your security command center.

### Step 2: Navigate the Dashboard
The main dashboard has three key areas:
- **Left Sidebar:** Your conversation history. Click **+ New Chat** to start a fresh conversation, or click any previous conversation to resume it.
- **Center Panel:** The main chat interface where you interact with the AI security agent.
- **Right Sidebar (Findings Panel):** Appears automatically after an audit completes, showing all discovered security findings sorted by severity. Click any finding to expand its details.

At the top of the page, you'll find navigation tabs:
- **Dashboard** — Main chat interface (default view)
- **Operations** — Automated security operations control plane
- **Compliance** — Framework-specific compliance tracking
- **Report** — Detailed audit reports with health scores

### Step 3: Connect Your AWS Account
1. On first login, the **Getting Started checklist** appears in the left panel. This checklist tracks your onboarding progress with green checkmarks.
2. Click **Step 1: Connect AWS Credentials** to open the credentials panel.
3. Choose your connection method:
   - **Access Keys tab (recommended for personal accounts):** Paste your IAM **Access Key ID** and **Secret Access Key** into the two input fields. Click **Connect**. The application immediately validates them against AWS STS and issues a temporary 1-hour session token. Your raw keys are **never stored** — they exist only in browser memory.
   - **Assume Role tab (recommended for cross-account auditing):** Paste the Role ARN (e.g., `arn:aws:iam::123456789012:role/CloudPilot-AuditRole`) and click **Connect**. The application calls `sts:AssumeRole` to obtain temporary credentials.
4. After successful connection, the **IAM Pre-Flight Check** runs automatically. A checklist appears showing green ✅ or red ❌ icons for each capability (S3 read, IAM audit, CloudTrail access, Security Group modification, etc.). This tells you exactly what the agent can and cannot do with your permissions.
5. A green checkmark appears on Step 1 of the Getting Started checklist.

### Step 4: Configure Notification Email (Optional)
1. In the Getting Started checklist, click **Step 2: Set Notification Email**.
2. Enter your email address — the agent will use AWS SNS to send you report summaries after each audit.
3. You'll receive a one-time SNS subscription confirmation email. Click **Confirm subscription** in that email.
4. Once confirmed, every audit the agent runs will automatically email you a summary.

### Step 5: Choose Your Scan Mode
Before querying the agent, select your AI engine using the **Scan Mode toggle bar** at the bottom of the chat input:
- **⚡ Fast Scan (Claude Sonnet 5):** Quick, focused queries — security group checks, listing resources, single-service audits. Responds in **~2–5 seconds**.
- **🔍 Deep Audit (Claude Opus 5):** Comprehensive, multi-service analysis — full CIS Benchmark evaluations, IAM privilege escalation path discovery, CloudTrail event correlation. Responds in **~10–20 seconds** with extended reasoning.

You can switch between modes at any time — the toggle is always visible directly below the chat input field.

### Step 6: Use Quick Action Prompts (Prebuilt Commands)
Instead of typing from scratch, click the **Quick Actions button** (grid icon, located to the left of the chat input field) to browse prebuilt prompts organized by category:
- **Security Audits:** "Run a full security audit", "Check S3 public access", "Audit IAM policies"
- **Cost Analysis:** "Show my cost breakdown", "Find idle resources", "Set a budget alert"
- **Drift Detection:** "Capture a baseline", "Show overnight drift"
- **Incident Response:** "Run incident response playbook", "Isolate compromised instance"
- **Attack Simulation:** "Simulate privilege escalation", "Map lateral movement paths"
- **Event Automation:** "If anyone opens port 22, close it automatically"

**Important:** Clicking a Quick Action does **not** send it immediately. It populates the chat input field so you can review, edit, or add context (e.g., a specific region or resource name) before pressing Enter.

### Step 7: Query the AI Security Agent
Type your security question into the chat input and press **Enter** (or click the **Send** button on the right).

**What you'll see:**
1. A **skill badge** appears (e.g., `🔐 Security Audit Specialist` or `💰 FinOps Cost Analyst`) — this tells you which specialist persona the agent activated for your query.
2. A **thinking indicator** shows the agent's live execution steps ("Classifying intent...", "Skill activated", "Calling AWS API...", "Safety Gate APPROVED").
3. The agent's response **streams in real-time** as structured Markdown — including findings tables, severity ratings, remediation commands, and compliance mappings.

**Example queries to try:**
| What You Type | Skill That Activates |
|--------------|---------------------|
| "Audit my S3 buckets for public access" | 🔐 Security Audit Specialist |
| "Where am I wasting money?" | 💰 FinOps Cost Analyst |
| "What changed since last night?" | 📊 Drift Detection Engineer |
| "Simulate privilege escalation on my IAM roles" | 🎯 Red Team Simulation Expert |
| "If anyone opens port 22, close it" | 🔔 Event Automation Specialist |
| "List my EC2 instances in us-east-1" | 🔍 Direct Query Agent |

> **How it works behind the scenes:** Your query goes through a 5-stage pipeline: (1) Intent Classification categorizes your query into one of 9 domains, (2) the Agent Skills Engine loads a domain-specific specialist persona, (3) Tool Filtering narrows the active tool set, (4) the ReAct Loop executes multi-iteration reasoning with live AWS API calls, and (5) the Safety Gate Judge pre-screens every proposed API call before execution. You don't need to know any of this to use CloudPilot — it all happens automatically.

### Step 8: Inspect Findings & Remediate
After the agent completes its analysis:
1. **Findings Panel:** The right sidebar automatically populates with all discovered findings. Each finding shows:
   - **Severity badge** (Critical / High / Medium / Low) with color coding
   - **Affected resource ID** (e.g., `sg-0a1b2c3d`, `arn:aws:s3:::my-bucket`)
   - **CIS Benchmark mapping** (e.g., CIS 2.1.1)
   - **Remediation command** — a copy-paste-ready AWS CLI command to fix the issue
2. **Account Health Score:** Displayed at the top of the Report page — a real-time 0–100 score calculated from finding severity. Weighted deductions: Critical (-20 pts), High (-8 pts), Medium (-3 pts), Low (-1 pt).
3. **One-Click Fix:** Click the **Fix** button (wrench icon) on any finding — it auto-populates a remediation prompt in the chat so the agent can execute the fix for you. Requires write-level IAM permissions.

### Step 9: Archive Reports & Export Evidence
On each agent response in the chat, you'll see action buttons in the **top-right corner of the response bubble**:
1. **Add to S3** — Archives the full security report to your S3 bucket in WORM (Write-Once-Read-Many) compliance mode for immutable audit records.
2. **Download PDF** — Generates a local PDF copy for offline review or compliance evidence submissions.
3. **Email via SNS** — If you configured a notification email in Step 4, report summaries are sent automatically after each audit.

### Step 10: Explore the Skills Catalog & Author Custom Personas
Click the **Skills** tab in the top navigation bar to enter the **Skills Catalog & Persona Studio**:
1. **Built-in Personas:** Browse all 9 default specialist skills. Click **View Prompt** on any skill to inspect the exact system supplement and priorities injected into Claude's context.
2. **Run in Chat:** Click **Run in Chat** on any skill card to auto-populate a targeted query in the chat console that activates that specific specialist persona.
3. **Custom Skill Studio:** Click **Create Custom Skill** or pick a preset template (e.g., *Kubernetes & EKS Hardener*, *HIPAA Compliance Guard*, *Serverless FinOps Scout*).
4. **Define Directives & Tool Access:** Set custom trigger keywords, select allowed AWS SDK tools, and write custom system directives. Custom skills persist locally in SQLite and automatically trigger during chat when your keywords match.

### Step 11: Explore the Operations Control Plane
Click the **Operations** tab in the top navigation bar to access the centralized operations dashboard:
1. **Event Policies:** View and manage CloudTrail event response rules (e.g., "auto-close port 22 if opened").
2. **Cost Rules:** Set budget thresholds and spending anomaly alerts.
3. **Drift Baselines:** View captured configuration baselines and track any deviations.
4. **Runbook History:** See all executed runbooks with step-by-step logs, resource IDs, and outcomes.
5. **Audit Timelines:** Browse a chronological log of every agent action taken on your account.

💡 **Tip:** Click **Start Tour** at the top of the Operations page for a guided, auto-scrolling walkthrough that highlights and explains each section.

### Step 12: Explore the Compliance Control Plane
Click the **Compliance** tab in the top navigation bar:
1. **Framework Selector:** Choose from SOC 2, ISO 27001, HIPAA, PCI-DSS v4.0, CIS AWS Foundations, NIST 800-53, and 8 more frameworks.
2. **Compliance Dials:** Visual gauges showing your compliance percentage per framework.
3. **Interactive Checklists:** Drill into specific controls to see pass/fail status and remediation guidance for each.

💡 **Tip:** Click **Start Tour** for a guided walkthrough of the compliance features.

### Step 13: Manage Your Team
1. Click your **profile icon** in the top-right corner and select **Team Settings** (or click the **Team** tab).
2. **Invite members** by email — CloudPilot handles shadow accounts for users who haven't signed up yet, so they'll get full access the moment they create an account.
3. Team members can share conversations, audit histories, and compliance reports across the organization.

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