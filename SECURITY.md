# Security Policy

## Supported Versions

Security fixes and patches are provided for the following versions of DAW Buddy:

| Version | Supported          |
| ------- | ------------------ |
| 0.4.x   | :white_check_mark: |
| < 0.4.0 | :x:                |

---

## Reporting a Vulnerability

We take the security and privacy of DAW Buddy and its users seriously. If you believe you have discovered a security vulnerability, please follow responsible disclosure guidelines:

### How to Report:
1. **GitHub Private Vulnerability Reporting (Preferred)**:
   - Navigate to the [Security Advisories](https://github.com/hrdsht/daw_buddy/security/advisories) tab on GitHub.
   - Click **"Report a vulnerability"** to open a confidential report.
2. **Direct Contact**:
   - If GitHub Private Vulnerability Reporting is unavailable, please contact the maintainer directly at **hpkalas@gmail.com**.

### What to Include:
To help us triage and resolve the issue quickly, please include:
- A clear description of the vulnerability and its potential impact.
- Step-by-step instructions or proof-of-concept (PoC) to reproduce the issue.
- The operating system, platform (Windows / macOS / Linux), and DAW Buddy version tested.
- Any relevant logs, stack traces, or proposed fixes.

### Response Timeline:
- **Acknowledgement**: We aim to acknowledge receipt of your vulnerability report within **48 hours**.
- **Assessment**: We will evaluate the impact and keep you informed of our progress.
- **Resolution**: Once a fix is verified, a patch release and security advisory will be published with credit given to the reporter (unless you request anonymity).

---

## Core Security & Privacy Invariants

DAW Buddy is architected around strict privacy and safety guarantees:

1. **Zero Cloud Dependencies & 100% Local Privacy**:
   - DAW Buddy runs entirely on your local machine.
   - No audio files, project session files, stems, metadata, or telemetry are ever uploaded to any external server or cloud service.
2. **Non-Destructive Filesystem Operations**:
   - The scanner and indexer operate strictly in **read-only** mode on user project roots.
   - File deduplication utilizes safe filesystem hard links (`fs.link`) with volume checks and atomic swaps.
   - Stem renaming creates rollback manifests (`renamelog.json`) for reversible operations.
3. **Safe Process Isolation**:
   - Electron windows run with `contextIsolation: true`, `nodeIntegration: false`, and strictly defined IPC boundaries via preloads.
