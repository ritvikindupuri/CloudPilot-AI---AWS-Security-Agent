# CloudPilot Security Hardening Guide

## Overview

This document describes the defensive security hardening measures implemented in CloudPilot and provides guidance for secure deployment and operation.

## Critical Security Controls

### 1. Auto-Elevation Gating (CRITICAL)

**Risk**: The AWS executor function previously had auto-elevation logic that was **always active**, automatically attaching AWS-managed FullAccess policies when encountering AccessDenied errors. This violated the principle of least privilege and could lead to unintended privilege escalation.

**Fix**: Auto-elevation is now **gated by the `ENABLE_AUTO_ELEVATION` environment variable** and is **disabled by default**.

**Configuration**:
```bash
# Default (secure): Auto-elevation disabled
ENABLE_AUTO_ELEVATION="false"

# Only enable if you explicitly trust the agent with IAMFullAccess
ENABLE_AUTO_ELEVATION="true"
```

**Recommendation**: Keep `ENABLE_AUTO_ELEVATION` disabled unless you have a documented operational requirement and have implemented compensating controls (audit logging, time-bounded sessions, restricted CIDR ranges for API calls).

### 2. CORS Protection

**Risk**: Accepting requests from any origin via wildcard CORS (`*`) allows malicious websites to make authenticated requests to CloudPilot APIs on behalf of logged-in users.

**Fix**: 
- All edge functions now require `ALLOWED_ORIGIN` to be explicitly set in production
- The application fails to start if `ENVIRONMENT=production` and `ALLOWED_ORIGIN` is not set
- No wildcards are used

**Configuration**:
```bash
# Production (REQUIRED)
ENVIRONMENT="production"
ALLOWED_ORIGIN="https://cloudpilot.app"

# Development
ALLOWED_ORIGIN="http://localhost:8080"
```

**Recommendation**: Always set `ALLOWED_ORIGIN` to your exact frontend domain. Never use wildcards (`*`) or multiple origins in production.

### 3. Security Headers

**Risk**: Missing security headers leave the application vulnerable to:
- Clickjacking attacks (no X-Frame-Options)
- MIME-sniffing attacks (no X-Content-Type-Options)
- Cross-site scripting (no XSS protection)

**Fix**: All edge functions now return the following security headers:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(), camera=()`

**Note**: Content Security Policy (CSP) is not yet implemented due to the complexity of React/Vite applications. See "Residual Gaps" section below.

### 4. Error Information Disclosure

**Risk**: Returning detailed AWS error messages to clients leaks information about the AWS environment (account structure, IAM policies, resource names) that could aid attackers.

**Fix**: 
- Production error messages are now sanitized
- HTTP status codes properly reflect error conditions (403 for access denied, 500 for internal errors)
- Detailed error information is only logged server-side

### 5. Authentication Enforcement

**Status**: ✅ Already implemented correctly

CloudPilot edge functions properly enforce authentication:
- `aws-credential-vault`: Validates Supabase JWT and enforces credential ownership
- `aws-agent`: User context is properly validated
- No public endpoints that accept AWS credentials

### 6. Input Validation

**Status**: ✅ Already implemented correctly

The `aws-exchange-credentials` function implements proper input validation:
- AWS region format validation
- Access key format validation
- Secret key sanitization
- Role ARN format validation
- Maximum length constraints

### 7. Secret Handling

**Status**: ✅ Already implemented correctly

CloudPilot implements proper secret management:
- AWS credentials encrypted with AES-256-GCM in the database
- Key derivation using PBKDF2 with user-specific salt
- No secrets hardcoded in the repository
- Credentials never logged or returned in error messages

## Deployment Checklist

Before deploying CloudPilot to production, ensure:

- [ ] `ENVIRONMENT="production"` is set
- [ ] `ALLOWED_ORIGIN` is set to your exact frontend domain
- [ ] `ENABLE_AUTO_ELEVATION` is set to `"false"` (or explicitly documented if `"true"`)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is rotated from any default/example value
- [ ] Database row-level security (RLS) policies are enabled on all tables
- [ ] Supabase Auth is configured with:
  - [ ] Email verification required
  - [ ] Strong password requirements
  - [ ] MFA available for users
- [ ] AWS IAM credentials used by CloudPilot follow least privilege:
  - [ ] Read-only access for scanning/auditing
  - [ ] Time-bounded sessions where possible
  - [ ] CloudTrail logging enabled for all API calls
  - [ ] IP allowlisting configured if feasible

## Residual Security Gaps

The following security improvements are **not** included in this PR and should be addressed in future work:

### High Priority

1. **Content Security Policy (CSP)**
   - **Gap**: No CSP headers are implemented
   - **Risk**: XSS attacks are not mitigated by CSP
   - **Recommendation**: Implement a CSP that allows only necessary resources. This is complex with Vite/React and requires careful testing.

2. **Rate Limiting**
   - **Gap**: No rate limiting on edge functions
   - **Risk**: API abuse, credential stuffing, DoS attacks
   - **Recommendation**: Implement rate limiting at the Supabase/Cloudflare level or within edge functions

3. **Audit Logging**
   - **Gap**: Limited audit logging of sensitive operations
   - **Risk**: Insufficient forensics in case of security incident
   - **Recommendation**: Log all credential access, AWS API calls, auto-elevation events, and authentication events

4. **Session Management**
   - **Gap**: No explicit session timeout configuration
   - **Risk**: Long-lived sessions increase attack window
   - **Recommendation**: Configure aggressive session timeouts (1-4 hours) for production

### Medium Priority

5. **Dependency Vulnerabilities**
   - **Gap**: No automated dependency scanning in CI/CD
   - **Risk**: Known vulnerabilities in npm packages
   - **Recommendation**: Integrate `npm audit` and Dependabot into CI pipeline

6. **AWS Credentials Validation**
   - **Gap**: Credentials are validated by attempting to use them, but there's no proactive expiration check
   - **Risk**: Expired credentials may be stored
   - **Recommendation**: Implement credential health checks

7. **HTTPS Enforcement**
   - **Gap**: No explicit HSTS header with long max-age
   - **Risk**: Downgrade attacks
   - **Recommendation**: Add `Strict-Transport-Security: max-age=31536000; includeSubDomains`

### Low Priority

8. **Subresource Integrity (SRI)**
   - **Gap**: No SRI hashes for external resources
   - **Risk**: Compromised CDN could inject malicious code
   - **Recommendation**: Add SRI hashes for all external scripts/styles

9. **Chart.tsx dangerouslySetInnerHTML**
   - **Gap**: `chart.tsx` uses `dangerouslySetInnerHTML` for CSS variable injection
   - **Risk**: XSS if chart config is user-controlled (currently not the case)
   - **Recommendation**: Audit all uses of `dangerouslySetInnerHTML` and sanitize input

## Testing Security Controls

### Test CORS Protection

```bash
# Should fail in production without ALLOWED_ORIGIN
curl -X POST https://your-edge-function.supabase.co/aws-executor \
  -H "Origin: https://evil.com" \
  -H "Content-Type: application/json" \
  -d '{"service":"IAM","commandName":"ListUsers"}'

# Should succeed with correct origin
curl -X POST https://your-edge-function.supabase.co/aws-executor \
  -H "Origin: https://cloudpilot.app" \
  -H "Content-Type: application/json" \
  -d '{"service":"IAM","commandName":"ListUsers"}'
```

### Test Auto-Elevation Gating

```bash
# Should return AccessDenied without attempting elevation
ENABLE_AUTO_ELEVATION="false"

# Should attempt elevation (requires IAMFullAccess)
ENABLE_AUTO_ELEVATION="true"
```

### Test Security Headers

```bash
curl -I https://your-edge-function.supabase.co/aws-agent
# Should see:
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
# X-XSS-Protection: 1; mode=block
```

## Incident Response

If you suspect a security incident:

1. **Immediately rotate** all AWS credentials stored in CloudPilot
2. **Review CloudTrail logs** for unauthorized AWS API calls
3. **Check Supabase logs** for suspicious authentication attempts
4. **Disable auto-elevation** if it was enabled
5. **Review database audit logs** for unauthorized credential access
6. **Notify users** if credentials may have been compromised

## Security Contact

For security vulnerabilities, please contact the CloudPilot security team (or repository owner) via private disclosure rather than opening a public issue.

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [AWS Security Best Practices](https://aws.amazon.com/security/best-practices/)
- [Supabase Security](https://supabase.com/docs/guides/platform/security)
- [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
