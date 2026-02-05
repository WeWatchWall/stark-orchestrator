# Stark Orchestrator – Realistic Effort-Weighted Week Plan

| Week        | Tasks                                                        | Estimated Effort (sum of difficulty units) | Notes                                                     |
| ----------- | ------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------- |
| **Week 1**  | 1–2 Kernel / Core System                                     | 3 + 3 = 6                                  | Foundation for everything else; core pod & event handling |
| **Week 2**  | 3–4 Node & Cluster Management                                | 3 + 3 = 6                                  | Node registration, heartbeats, basic orchestration        |
| **Week 3**  | 5–7 Networking: Ingress + Service Discovery + Load Balancing | 3 + 3 + 3 = 9                              | Network layer ready before chaos & traffic management     |
| **Week 4**  | 8 Chaos Engineering & Network Chaos                          | 2 + 2 = 4                                  | Realistic chaos testing now that networking is in place   |
| **Week 5**  | 9 Secrets & Security                                         | 2 + 2 = 4                                  | TLS, RBAC, auditing; ensures safe storage & access        |
| **Week 6**  | 10–12 Persistence: PV abstraction, PVCs, snapshot/restore    | 3 + 3 + 3 = 9                              | Hardest week; safe pod state + chaos-safe storage         |
| **Week 7**  | 13–14 Persistence wrap-up                                    | 3 + 2 = 5                                  | Polish rescheduling, cleanup; minor fixes                 |
| **Week 8**  | 15–19 UI / Dashboard                                         | 2 + 2 + 2 + 2 + 1 = 9                      | Build UI against stable back-end                          |
| **Week 9**  | 20–23 Regression & Reliability                               | 2 + 3 + 2 + 2 = 9                          | Full regression & metrics; validate all subsystems        |
| **Week 10** | 24–27 Optional / Advanced                                    | 3 + 3 + 2 + 2 = 10                         | Only after everything else; polish, extra features        |

