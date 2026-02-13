# TODO List
| #                                   | Task                                                    | Difficulty | Status    |
| ----------------------------------- | ------------------------------------------------------- | ---------- | --------- |
| **Networking & Traffic Management** |                                                         |            |           |
| 1                                   | Implement basic Ingress routing for pods                | Hard       | ☐ TODO    |
| 2                                   | Add Service Discovery for pods                          | Hard       | ✅ Done    |
| 3                                   | Implement Load Balancing between nodes                  | Hard       | ✅ Done    |
| 4                                   | Polish ingress/LB configuration & edge cases            | Medium     | ⛔ Skipped |
| 5                                   | Test network failures + chaos (slow/dropped packets)    | Medium     | ⏳ Deferred|
| **Secrets & Security**              |                                                         |            |           |
| 6                                   | Implement secrets management API (keys/passwords/certs) | Medium     | ☐ TODO    |
| 7                                   | Enable TLS for node-orchestrator communication          | Medium     | ✅ Done   |
| 8                                   | Add RBAC enforcement for pod capabilities               | Medium     | ✅ Done    |
| 9                                   | Add auditing/logging hooks for sensitive actions        | Medium     | ⏳ Deferred|
| **Persistence & State**             |                                                         |            |           |
| 10                                  | Implement persistent volume abstraction for pods        | Hard       | ☐ TODO    |
| 11                                  | Support PVCs and attach/detach logic                    | Hard       | ⛔ Skipped |
| 12                                  | Implement snapshot/restore for volumes                  | Hard       | ⛔ Skipped |
| 13                                  | Polish volume handling and cleanup                      | Medium     | ⏳ Deferred|
| 14                                  | Test stateful pods during node failure & reschedule     | Hard       | ⛔ Skipped |
| **UI / Dashboard**                  |                                                         |            |  ⏳ Deferred|
| 15                                  | Implement basic cluster overview (nodes + pods)         | Medium     | ☐ TODO    |
| 16                                  | Add pod placement visualization                         | Medium     | ☐ TODO    |
| 17                                  | Add metrics visualization (node health, pod counts)     | Medium     | ☐ TODO    |
| 18                                  | Add event timeline / chaos scenario visualization       | Medium     | ☐ TODO    |
| 19                                  | Add filters and search for nodes/pods                   | Easy       | ☐ TODO    |
| **Full Regression & Reliability**   |                                                         |            |           |
| 20                                  | Implement historical log & event storage                | Medium     | ✅ Done   |
| 21                                  | Generate reliability metrics (uptime, pod reschedules)  | Medium     | ✅ Done   |
| 22                                  | Create automated regression tests for chaos scenarios   | Hard       | ⏳ Deferred|
| 23                                  | Add reporting/dashboard integration for regression      | Medium     | ⛔ Skipped|
| **Advanced / Optional**             |                                                         |            |           |
| 24                                  | Advanced networking (overlay/multi-network)             | Hard       | ⛔ Skipped |
| 25                                  | Multi-cluster support (federation/hybrid)               | Hard       | ⛔ Skipped |
| 26                                  | Multi-tenancy support                                   | Medium     | ⛔ Skipped |
| 27                                  | AI-assisted scheduling optimization                     | Medium     | ⛔ Skipped |
