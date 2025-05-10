# Infra Setup

This folder contains infrastructure configuration and a Dockerfile for building a PocketBase image.

## 1. Build the Docker Image

You can build the Docker image using the provided Dockerfile:

```powershell
docker build -t stark-orchestrator-pocketbase:latest .
```

## 2. Run the Container (Set Superuser Credentials)

Set the superuser email and password at runtime using environment variables:

```powershell
docker run -e PB_SUPERUSER_EMAIL=admin@localhost -e PB_SUPERUSER_PASSWORD=admin -p 8080:8080 stark-orchestrator-pocketbase:latest
```

- Replace the values of `PB_SUPERUSER_EMAIL` and `PB_SUPERUSER_PASSWORD` as needed.

## 3. Deploy with Terraform

This folder contains Terraform configuration files. To deploy the infrastructure (including the Docker image), follow these steps:

### Initialize Terraform

```powershell
terraform init
```

### Review the Execution Plan

```powershell
terraform plan
```

### Apply the Configuration

```powershell
terraform apply
```

- Confirm the action when prompted.
- Make sure your Terraform configuration is set up to use the built Docker image (update image references as needed).

---

**Note:**

- Ensure Docker is running and you are authenticated to any required registries if pushing the image.
- Adjust Terraform variables and provider settings as needed for your environment.
- Superuser credentials are now set securely at runtime, not at build time.
