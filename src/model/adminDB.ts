import PocketBase from "pocketbase";
import { ServerConfig } from "../entity/serverConfig";
import { APP_NAME, COLLECTION_VALUES } from "../util/constants";

export class AdminDB {
  serverConfig: ServerConfig;
  pocketBase: PocketBase;

  constructor(serverConfig: ServerConfig) {
    this.serverConfig = serverConfig;

    this.pocketBase = new PocketBase(
      `${serverConfig.DBHost}:${serverConfig.DBPort}`
    );
  }

  async init(): Promise<void> {
    try {
      await this.pocketBase
        .collection("_superusers")
        .authWithPassword(
          this.serverConfig.DBUser,
          this.serverConfig.DBpassword
        );
    } catch (error) {
      console.error("Error authenticating with PocketBase:", error);
      throw error;
    }

    let valuesCollection;
    try {
      valuesCollection = await this.pocketBase.collections.getFirstListItem(
        "name='values'"
      );
    } catch (error) {
      // Ignore error if the collection doesn't exist
    }

    let applicationValue;
    if (valuesCollection) {
      applicationValue = await this.pocketBase
        .collection(COLLECTION_VALUES)
        .getFirstListItem("name='application'");
    }

    // If the adminDB is initialized, we can skip the rest of the initialization
    if (
      valuesCollection &&
      applicationValue &&
      applicationValue.expand &&
      applicationValue.expand["value"] === APP_NAME
    )
      return;

    // Create the collection if it doesn't exist
    if (!valuesCollection) {
      await this.pocketBase.collections.create({
        name: COLLECTION_VALUES,
        type: "base",
        fields: [
          {
            name: "name",
            type: "text",
            required: true,
          },
          {
            name: "value",
            type: "text",
            required: true,
          },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_values_unique_name ON values (name)'
        ],
      });
    }

    // Create the application value if it doesn't exist
    if (!applicationValue || !applicationValue.expand) {
      await this.pocketBase.collection(COLLECTION_VALUES).create({
        name: "application",
        value: APP_NAME,
      });
    }
  }
}
