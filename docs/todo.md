# TODO List
| #                                   | Task                                                    | Difficulty | Status |
| ----------------------------------- | ------------------------------------------------------- | ---------- | ------ |
| **Networking & Traffic Management** |                                                         |            |        |
| 1                                   | Implement basic Ingress routing for pods                | Hard       | ☐      |
| 2                                   | Add Service Discovery for pods                          | Hard       | ☐      |
| 3                                   | Implement Load Balancing between nodes                  | Hard       | ☐      |
| 4                                   | Polish ingress/LB configuration & edge cases            | Medium     | ☐      |
| 5                                   | Test network failures + chaos (slow/dropped packets)    | Medium     | ☐      |
| **Secrets & Security**              |                                                         |            |        |
| 6                                   | Implement secrets management API (keys/passwords/certs) | Medium     | ☐      |
| 7                                   | Enable TLS for node-orchestrator communication          | Medium     | ☐      |
| 8                                   | Add RBAC enforcement for pod capabilities               | Medium     | ☐      |
| 9                                   | Add auditing/logging hooks for sensitive actions        | Medium     | ☐      |
| **Persistence & State**             |                                                         |            |        |
| 10                                  | Implement persistent volume abstraction for pods        | Hard       | ☐      |
| 11                                  | Support PVCs and attach/detach logic                    | Hard       | ☐      |
| 12                                  | Implement snapshot/restore for volumes                  | Hard       | ☐      |
| 13                                  | Polish volume handling and cleanup                      | Medium     | ☐      |
| 14                                  | Test stateful pods during node failure & reschedule     | Hard       | ☐      |
| **UI / Dashboard**                  |                                                         |            |        |
| 15                                  | Implement basic cluster overview (nodes + pods)         | Medium     | ☐      |
| 16                                  | Add pod placement visualization                         | Medium     | ☐      |
| 17                                  | Add metrics visualization (node health, pod counts)     | Medium     | ☐      |
| 18                                  | Add event timeline / chaos scenario visualization       | Medium     | ☐      |
| 19                                  | Add filters and search for nodes/pods                   | Easy       | ☐      |
| **Full Regression & Reliability**   |                                                         |            |        |
| 20                                  | Implement historical log & event storage                | Medium     | ☐      |
| 21                                  | Generate reliability metrics (uptime, pod reschedules)  | Medium     | ☐      |
| 22                                  | Create automated regression tests for chaos scenarios   | Hard       | ☐      |
| 23                                  | Add reporting/dashboard integration for regression      | Medium     | ☐      |
| **Advanced / Optional**             |                                                         |            |        |
| 24                                  | Advanced networking (overlay/multi-network)             | Hard       | ☐      |
| 25                                  | Multi-cluster support (federation/hybrid)               | Hard       | ☐      |
| 26                                  | Multi-tenancy support                                   | Medium     | ☐      |
| 27                                  | AI-assisted scheduling optimization                     | Medium     | ☐      |
