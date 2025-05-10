# main.tf

variable "pb_superuser_email" {
  description = "PocketBase superuser email."
  type        = string
  default     = "admin@localhost.com"
}

variable "pb_superuser_password" {
  description = "PocketBase superuser password."
  type        = string
  default     = "adminpassword"
}

provider "docker" {
  # Optionally specify host, e.g.:
  # host = "npipe:////.//pipe//docker_engine" # for Windows
}

resource "docker_image" "pocketbase" {
  name = "stark-orchestrator-pocketbase:latest"
}

resource "docker_container" "pocketbase" {
  name  = "pocketbase"
  image = docker_image.pocketbase.image_id
  ports {
    internal = 8080
    external = 8080
  }
  env = [
    "PB_SUPERUSER_EMAIL=${var.pb_superuser_email}",
    "PB_SUPERUSER_PASSWORD=${var.pb_superuser_password}"
  ]
  # Uncomment and adjust if you want to mount volumes:
  # mounts {
  #   target = "/pb/pb_migrations"
  #   source = "${path.module}/pb_migrations"
  #   type   = "bind"
  # }
}
