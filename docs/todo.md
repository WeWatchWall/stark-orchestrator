# TODO List

| #                                   | Task                                                    | Difficulty | Status |
| ----------------------------------- | ------------------------------------------------------- | ---------- | ------ |
| **Networking & Traffic Management** |                                                         |            |        |
| 1                                   | Implement basic Ingress routing for pods                | Hard       | ☐      |
| 2                                   | Add Service Discovery for pods                          | Hard       | ☐      |
| 3                                   | Implement Load Balancing between nodes                  | Hard       | ☐      |
| 4                                   | Test network failures + chaos (slow/dropped packets)    | Medium     | ☐      |
| 5                                   | Polish ingress/LB configuration & edge cases            | Medium     | ☐      |
| **Secrets & Security**              |                                                         |            |        |
| 6                                   | Implement secrets management API (keys/passwords/certs) | Medium     | ☐      |
| 7                                   | Add RBAC enforcement for pod capabilities               | Medium     | ☐      |
| 8                                   | Enable TLS for node-orchestrator communication          | Medium     | ☐      |
| 9                                   | Add auditing/logging hooks for sensitive actions        | Medium     | ☐      |
| **Persistence & State**             |                                                         |            |        |
| 10                                  | Implement persistent volume abstraction for pods        | Hard       | ☐      |
| 11                                  | Support PVCs and attach/detach logic                    | Hard       | ☐      |
| 12                                  | Implement snapshot/restore for volumes                  | Hard       | ☐      |
| 13                                  | Test stateful pods during node failure & reschedule     | Hard       | ☐      |
| 14                                  | Polish volume handling and cleanup                      | Medium     | ☐      |
| **UI / Dashboard**                  |                                                         |            |        |
| 15                                  | Implement basic cluster overview (nodes + pods)         | Medium     | ☐      |
| 16                                  | Add pod placement visualization                         | Medium     | ☐      |
| 17                                  | Add metrics visualization (node health, pod counts)     | Medium     | ☐      |
| 18                                  | Add event timeline / chaos scenario visualization       | Medium     | ☐      |
| 19                                  | Add filters and search for nodes/pods                   | Easy       | ☐      |
| **Full Regression & Reliability**   |                                                         |            |        |
| 20                                  | Implement historical log & event storage                | Medium     | ☐      |
| 21                                  | Create automated regression tests for chaos scenarios   | Hard       | ☐      |
| 22                                  | Generate reliability metrics (uptime, pod reschedules)  | Medium     | ☐      |
| 23                                  | Add reporting/dashboard integration for regression      | Medium     | ☐      |
| **Advanced / Optional**             |                                                         |            |        |
| 24                                  | Multi-cluster support (federation/hybrid)               | Hard       | ☐      |
| 25                                  | Advanced networking (overlay/multi-network)             | Hard       | ☐      |
| 26                                  | Multi-tenancy support                                   | Medium     | ☐      |
| 27                                  | AI-assisted scheduling optimization                     | Medium     | ☐      |
