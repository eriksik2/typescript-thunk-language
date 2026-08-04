import { use, provide, type Thunk } from "@thunk/runtime";
import { succeed, defer, bind, execute, __makeSymbol } from "@thunk/runtime/internal";

declare const __brand_Config: unique symbol;
const Config = __makeSymbol<{
  environment: string;
}>("Config") as unknown as ((value: {
  environment: string;
}) => Config) & { readonly key: symbol; readonly __assoc: {
  environment: string;
} };
type Config = {
  environment: string;
} & { readonly [__brand_Config]: typeof __brand_Config } & { readonly __assoc: {
  environment: string;
} } & { readonly __symbolIdentity?: typeof Config };

const ProductionConfig = Config({
  environment: "prod",
});
interface User {
  id: string
  name: string
};
declare const __brand_Database: unique symbol;
const Database = __makeSymbol<{
  name: string;

  getUser: (id: string) => Thunk<User>;
}>("Database") as unknown as ((value: {
  name: string;

  getUser: (id: string) => Thunk<User>;
}) => Database) & { readonly key: symbol; readonly __assoc: {
  name: string;

  getUser: (id: string) => Thunk<User>;
} };
type Database = {
  name: string;

  getUser: (id: string) => Thunk<User>;
} & { readonly [__brand_Database]: typeof __brand_Database } & { readonly __assoc: {
  name: string;

  getUser: (id: string) => Thunk<User>;
} } & { readonly __symbolIdentity?: typeof Database };

const DatabaseLive = defer(() => bind(use(Config), config => succeed(Database({
    name: config.environment,
    getUser: (id: string) => defer(() => succeed({
        id,
        name: "John Doe",
      }))
  }))));
const fetchUser = defer(() => bind(use(Database), db => bind(db.getUser("1234"), user => succeed(db.name + " " + user.name))));
const program = defer(() => bind(DatabaseLive, db => bind(provide(
    fetchUser,
    db,
  ), __v => succeed(__v))));
const result = execute(provide(program, ProductionConfig));
console.log(result);
