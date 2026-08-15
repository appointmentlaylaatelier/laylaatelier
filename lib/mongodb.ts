type MongoDb = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  collection: (name: string) => any;
};

type MongoClientLike = {
  connect: () => Promise<MongoClientLike>;
  db: (name: string) => MongoDb;
};

declare global {
  var __atelierMongoClientPromise: Promise<MongoClientLike> | undefined;
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

async function createClient(uri: string): Promise<MongoClientLike> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore -- mongodb is declared in package.json and installed by the deployment environment.
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 }) as MongoClientLike;
  return client.connect();
}

export async function getDb(): Promise<MongoDb> {
  const uri = required("MONGODB_URI");
  const dbName = process.env.MONGODB_DB || "mern_admin";
  if (!global.__atelierMongoClientPromise) global.__atelierMongoClientPromise = createClient(uri);
  const client = await global.__atelierMongoClientPromise;
  return client.db(dbName);
}
