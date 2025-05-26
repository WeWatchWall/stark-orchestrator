import { Command } from "commander";
import { runServers } from "./server";

const program = new Command();
program
  .option(
    "-p, --httpPort <number>",
    "port for the HTTP server (external)",
    "3080"
  )
  .option(
    "-s, --httpsPort <number>",
    "port for the HTTPS server (external)",
    "3443"
  )
  .option("--exposeHttp", "expose the HTTP server", false)
  .option(
    "--dbHost <string>",
    "Pocketbase host",
    "http://localhost"
  )
  .option(
    "--dbUser <string>",
    "Pocketbase admin user",
    "admin@localhost.com"
  )
  .option(
    "--dbPassword <string>",
    "Pocketbase password for admin user",
    "adminpassword"
  )
  .option(
    "--dbPort <number>",
    "Pocketbase port",
    "8080"
  )
  .option("-c, --isSecureCookie", "use secure cookies", false)
  .parse(process.argv);

const options = program.opts();
const httpPort = parseInt(options.httpPort, 10);
const httpsPort = parseInt(options.httpsPort, 10);
const exposeHttp: boolean = options.exposeHttp;
const isSecureCookie: boolean = options.isSecureCookie;
const dbPort = parseInt(options.dbPort, 10);

(async () => {
  await runServers(
    httpPort,
    exposeHttp,
    httpsPort,
    {
      DBHost: options.dbHost,
      DBUser: options.dbUser,
      DBpassword: options.dbPassword,
      DBPort: dbPort,
      isSecureCookie,
    }
  );
})();
