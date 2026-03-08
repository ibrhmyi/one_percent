import fs from "node:fs/promises";
import path from "node:path";
import { appConfig } from "@/lib/config";
import { normalizedMarketSchema, type MarketStore, type NormalizedMarket } from "@/lib/types";
import { z } from "zod";

const cacheSnapshotSchema = z.object({
  lastUpdated: z.string().nullable(),
  markets: z.array(normalizedMarketSchema)
});

type CacheSnapshot = z.infer<typeof cacheSnapshotSchema>;

const emptySnapshot: CacheSnapshot = {
  lastUpdated: null,
  markets: []
};

export class JsonMarketStore implements MarketStore {
  constructor(private readonly filePath = appConfig.cacheFilePath) {}

  async getMarkets() {
    const snapshot = await this.readSnapshot();
    return snapshot.markets;
  }

  async saveMarkets(markets: NormalizedMarket[]) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    const snapshot: CacheSnapshot = {
      lastUpdated: new Date().toISOString(),
      markets
    };

    await fs.writeFile(this.filePath, JSON.stringify(snapshot, null, 2), "utf8");
  }

  async getLastUpdated() {
    const snapshot = await this.readSnapshot();
    return snapshot.lastUpdated;
  }

  private async readSnapshot() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return cacheSnapshotSchema.parse(JSON.parse(raw));
    } catch (error) {
      const isMissingFile =
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "string" &&
        error.code === "ENOENT";

      if (isMissingFile) {
        return emptySnapshot;
      }

      return emptySnapshot;
    }
  }
}

export const marketStore = new JsonMarketStore();
