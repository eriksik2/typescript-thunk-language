import { use, provide, layerOf } from "@thunk/runtime";
import { succeed, defer, bind, execute, __makeSymbol } from "@thunk/runtime/internal";
import type { Thunk } from "@thunk/types";

declare const __brand_Database: unique symbol;
type Database = {
  name: string
} & { readonly [__brand_Database]: typeof __brand_Database } & { readonly __assoc: {
  name: string
} };
const Database = __makeSymbol<{
  name: string
}>("Database") as unknown as ((value: {
  name: string
}) => Database) & { readonly key: symbol; readonly __assoc: {
  name: string
} };

const fetchUser = defer(() => bind(use(Database), db => succeed(db.name)));
const program: Thunk<string> = provide(
  fetchUser,
  layerOf(Database, { name: "ada" }),
);
const result = execute(program);
console.log(result);
