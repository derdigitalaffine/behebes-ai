# Agenten-Orchestrierungsvertrag

`orchestration.json` ist eine **deklarative Ablauf- und Zuständigkeitsmatrix** für Coding-Agenten. Das JSON legt Rollenprofile, Gate-Reihenfolge und Prüfpflichten fest. Es löst selbst **keine Agenten aus**, vergibt keine Zugriffsrechte und führt keine produktiven Operationen aus.

- Fachlicher Auftrag und verbindliche Invarianten: [`AGENTS.md`](../AGENTS.md).
- Ablauf, Parallelität und Übergaben: [`docs/AGENT_ORCHESTRATION.md`](../docs/AGENT_ORCHESTRATION.md).
- Ausführbare Agentenprofile (für unterstützte GitHub-Coding-Agenten): [`.github/agents/`](../.github/agents/).
- Validierung: `node scripts/check-agent-orchestration.mjs`.

Ein Agent/Integrator darf nach einem Gate erst fortfahren, wenn dessen Abnahme dokumentiert ist. Die deklarierte `humanApproval`-Stufe ist eine **menschliche Entscheidung**, keine automatisierbare Freigabe. Bei UI-only-Slices kann `frontend` anstelle von `backend` Implementierungsowner sein. Manche Gates sind fachlich „nicht betroffen“, dürfen aber nur mit begründeter Entscheidung übersprungen werden.
